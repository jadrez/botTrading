//+------------------------------------------------------------------+
//| MediaMovilOro.mq5  (v1.00)                                       |
//| Base nueva a partir del ejemplo "Moving Average" de MetaQuotes.  |
//|                                                                  |
//| Senal (al cerrar cada vela del marco InpTF), igual que el ejemplo|
//|   - COMPRA: la vela abrio por debajo de la media y cerro encima. |
//|   - VENTA : la vela abrio por encima de la media y cerro debajo. |
//| Mejoras sobre el ejemplo:                                        |
//|   - SL por ATR (y TP opcional) puesto en cada posicion.          |
//|   - Lote calculado para arriesgar InpRiskPct % del saldo.        |
//|   - Filtro opcional de tendencia (media lenta).                  |
//|   - Filtro de spread y de horario.                               |
//|   - Cierre por cruce contrario y reversa opcional.               |
//|   - Filtro de regimen ADX y trailing por ATR (opcionales).        |
//|   - Break-even para ganadoras y volteo tras SL en negativo (opc.).|
//| Una sola posicion a la vez. NO garantiza ganancias: probar en    |
//| el probador y en DEMO antes que nada.                            |
//+------------------------------------------------------------------+
#property version   "1.30"
#property description "Base de media movil para XAUUSD con SL por ATR y lote por riesgo. Probar siempre en demo."

#include <Trade/Trade.mqh>

input group "=== Senal ==="
input ENUM_TIMEFRAMES InpTF             = PERIOD_CURRENT;  // Marco de las velas (CURRENT = el del grafico / probador)
input int             InpMAPeriod       = 12;              // Periodo de la media movil
input ENUM_MA_METHOD  InpMAMethod       = MODE_SMA;        // Tipo de media (SMA, EMA, ...)
input int             InpFilterMAPeriod = 0;               // Filtro de tendencia: periodo de una EMA lenta (0 = apagado)
input int             InpAdxPeriod      = 14;              // ADX: periodo
input double          InpAdxMin         = 0.0;             // ADX: solo abre si el ADX es >= X (0 = apagado; 20-25 = mercado con tendencia)
input bool            InpExitOnCross    = true;            // Cerrar la posicion si aparece la senal contraria
input bool            InpReverse        = true;            // Despues de cerrar por senal contraria, abrir en el otro sentido

input group "=== Riesgo y SL / TP ==="
input double          InpFixedLot       = 0.0;             // Lote FIJO (0 = calcularlo por riesgo). Ej.: 0.05
input double          InpRiskPct        = 1.0;             // % del saldo que se pierde si toca el SL (solo si el lote fijo es 0)
input int             InpAtrPeriod      = 14;              // Periodo del ATR
input double          InpSLAtr          = 2.0;             // SL = X veces el ATR
input double          InpTPAtr          = 0.0;             // TP = X veces el ATR (0 = sin TP)
input double          InpTrailStartAtr  = 0.0;             // Trailing: se activa al ganar X veces el ATR (0 = apagado)
input double          InpTrailDistAtr   = 1.5;             // Trailing: el SL sigue al precio a X veces el ATR
input double          InpBreakEvenAtr   = 0.0;             // Proteger ganadoras: al ganar X veces el ATR, el SL pasa a break-even (0 = apagado)
input double          InpBreakEvenLockAtr = 0.2;           // Break-even: el SL queda X veces el ATR POR ENCIMA de la entrada (cubre comision y spread)
input bool            InpFlipOnSL       = false;           // Si una operacion toca el SL en NEGATIVO, abrir otra en el sentido contrario
input int             InpMaxFlips       = 1;               // Maximo de volteos seguidos tras SL (evita cadenas de perdidas)
input double          InpMaxRiskMult    = 1.5;             // No abrir si el lote minimo arriesga mas de X veces lo pedido

input group "=== Filtros y otros ==="
input double          InpMaxSpreadPts   = 0;               // Spread maximo en puntos para abrir (0 = sin limite)
input int             InpStartHour      = 0;               // Hora de inicio (hora del servidor)
input int             InpEndHour        = 24;              // Hora de fin (24 = todo el dia)
input long            InpMagic          = 20261111;        // Magic number

CTrade   trade;
int      g_ma      = INVALID_HANDLE;
int      g_filter  = INVALID_HANDLE;
int      g_atr     = INVALID_HANDLE;
int      g_adx     = INVALID_HANDLE;
datetime g_lastBar = 0;
double   g_atrCache   = 0.0;            // ATR de la ultima vela cerrada (para el break-even en cada tick)
bool     g_flipPending = false;         // hay un volteo pendiente tras tocar el SL en negativo
ENUM_ORDER_TYPE g_flipType = ORDER_TYPE_BUY;
int      g_flipCount  = 0;              // volteos seguidos

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpRiskPct <= 0.0 || InpSLAtr <= 0.0 || InpMAPeriod < 1)
   {
      Print("ERROR: InpRiskPct, InpSLAtr e InpMAPeriod deben ser mayores que 0.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   g_ma  = iMA(_Symbol, InpTF, InpMAPeriod, 0, InpMAMethod, PRICE_CLOSE);
   g_atr = iATR(_Symbol, InpTF, InpAtrPeriod);
   if(g_ma == INVALID_HANDLE || g_atr == INVALID_HANDLE)
   {
      Print("ERROR: no se pudo crear la media o el ATR.");
      return(INIT_FAILED);
   }
   if(InpFilterMAPeriod > 0)
   {
      g_filter = iMA(_Symbol, InpTF, InpFilterMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(g_filter == INVALID_HANDLE)
      {
         Print("ERROR: no se pudo crear la media de filtro.");
         return(INIT_FAILED);
      }
   }

   if(InpAdxMin > 0.0)
   {
      g_adx = iADX(_Symbol, InpTF, InpAdxPeriod);
      if(g_adx == INVALID_HANDLE)
      {
         Print("ERROR: no se pudo crear el ADX.");
         return(INIT_FAILED);
      }
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);
   PrintFormat("MediaMovilOro listo en %s, marco %s, media %d.", _Symbol, EnumToString(InpTF), InpMAPeriod);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(g_ma     != INVALID_HANDLE) IndicatorRelease(g_ma);
   if(g_filter != INVALID_HANDLE) IndicatorRelease(g_filter);
   if(g_atr    != INVALID_HANDLE) IndicatorRelease(g_atr);
   if(g_adx    != INVALID_HANDLE) IndicatorRelease(g_adx);
}

//+------------------------------------------------------------------+
double GetBuf(int handle, int shift)
{
   double buf[];
   if(CopyBuffer(handle, 0, shift, 1, buf) != 1) return 0.0;
   return buf[0];
}

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
{
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step > 0.0) lot = MathFloor(lot / step) * step;
   lot = MathMax(minLot, MathMin(maxLot, lot));
   return NormalizeDouble(lot, 2);
}

// USD que se pierden con 'lot' lotes si el precio se mueve 'dist' en contra.
double LossForMove(double lot, ENUM_ORDER_TYPE type, double price, double dist)
{
   double p2 = (type == ORDER_TYPE_BUY) ? price - dist : price + dist;
   double profit = 0.0;
   if(!OrderCalcProfit(type, _Symbol, lot, price, p2, profit) || profit >= 0.0) return 0.0;
   return -profit;
}

//+------------------------------------------------------------------+
// Posicion de este EA en este simbolo: devuelve true y llena ticket y tipo.
bool FindPosition(ulong &ticket, ENUM_POSITION_TYPE &ptype)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      ticket = t;
      ptype  = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
bool InTradingHours()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   if(InpStartHour <= InpEndHour) return (t.hour >= InpStartHour && t.hour < InpEndHour);
   return (t.hour >= InpStartHour || t.hour < InpEndHour);
}

//+------------------------------------------------------------------+
// 1 = compra, -1 = venta, 0 = sin senal. Usa la ultima vela cerrada (indice 1).
// forEntry = true aplica ademas los filtros (EMA lenta y ADX); para cerrar posiciones se usa el cruce sin filtros.
int Signal(bool forEntry)
{
   double ma = GetBuf(g_ma, 1);
   if(ma <= 0.0) return 0;
   double o = iOpen(_Symbol, InpTF, 1);
   double c = iClose(_Symbol, InpTF, 1);

   int s = 0;
   if(o < ma && c > ma) s = 1;
   else if(o > ma && c < ma) s = -1;
   if(s == 0) return 0;
   if(!forEntry) return s;

   // Filtro de regimen: solo con ADX suficiente (mercado con tendencia).
   if(g_adx != INVALID_HANDLE)
   {
      double adx = GetBuf(g_adx, 1);
      if(adx < InpAdxMin) return 0;
   }

   // Filtro de tendencia: solo en el sentido de la EMA lenta.
   if(g_filter != INVALID_HANDLE)
   {
      double f = GetBuf(g_filter, 1);
      if(f <= 0.0) return 0;
      if(s > 0 && c < f) return 0;
      if(s < 0 && c > f) return 0;
   }
   return s;
}

//+------------------------------------------------------------------+
bool OpenTrade(ENUM_ORDER_TYPE type)
{
   if(!InTradingHours()) return false;
   if(InpMaxSpreadPts > 0.0 && (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPts) return false;

   double atr = GetBuf(g_atr, 1);
   if(atr <= 0.0)
   {
      Print("ATR no disponible todavia.");
      return false;
   }

   double price  = (type == ORDER_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                                             : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double slDist = InpSLAtr * atr;
   double tpDist = (InpTPAtr > 0.0) ? InpTPAtr * atr : 0.0;

   double lot;
   if(InpFixedLot > 0.0)
   {
      // Lote fijo: se usa tal cual; el riesgo por operacion pasa a ser lote x distancia del SL.
      lot = NormalizeLot(InpFixedLot);
      PrintFormat("Lote fijo %.2f: riesgo aproximado si toca el SL = %.2f USD.", lot, LossForMove(lot, type, price, slDist));
   }
   else
   {
      // Lote para arriesgar InpRiskPct % del saldo con ese SL.
      double riskMoney  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
      double lossPerLot = LossForMove(1.0, type, price, slDist);
      if(lossPerLot <= 0.0)
      {
         Print("No se pudo calcular el lote (OrderCalcProfit fallo).");
         return false;
      }
      lot = NormalizeLot(riskMoney / lossPerLot);

      // Si el lote minimo ya arriesga mucho mas de lo pedido, no se abre.
      double actualRisk = LossForMove(lot, type, price, slDist);
      if(actualRisk > riskMoney * InpMaxRiskMult)
      {
         PrintFormat("No se abre: con el lote minimo %.2f el riesgo seria %.2f USD (limite %.2f USD).", lot, actualRisk, riskMoney * InpMaxRiskMult);
         return false;
      }
   }

   // Respeta la distancia minima del broker.
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(slDist < minDist) slDist = minDist;
   if(tpDist > 0.0 && tpDist < minDist) tpDist = minDist;

   double sl = (type == ORDER_TYPE_BUY) ? price - slDist : price + slDist;
   double tp = 0.0;
   if(tpDist > 0.0) tp = (type == ORDER_TYPE_BUY) ? price + tpDist : price - tpDist;
   sl = NormalizeDouble(sl, _Digits);
   if(tp > 0.0) tp = NormalizeDouble(tp, _Digits);

   bool ok = trade.PositionOpen(_Symbol, type, lot, price, sl, tp, "MediaMovilOro");
   if(!ok)
      PrintFormat("Fallo al abrir %s: %s", EnumToString(type), trade.ResultRetcodeDescription());
   return ok;
}

//+------------------------------------------------------------------+
// Trailing por ATR: el SL sigue al precio una vez que la posicion gana InpTrailStartAtr veces el ATR.
void TrailStop(ulong ticket, ENUM_POSITION_TYPE ptype)
{
   if(InpTrailStartAtr <= 0.0) return;
   if(!PositionSelectByTicket(ticket)) return;
   double atr = GetBuf(g_atr, 1);
   if(atr <= 0.0) return;

   double open    = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl      = PositionGetDouble(POSITION_SL);
   double tp      = PositionGetDouble(POSITION_TP);
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;

   if(ptype == POSITION_TYPE_BUY)
   {
      double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(price - open < InpTrailStartAtr * atr) return;
      double newSl = NormalizeDouble(price - InpTrailDistAtr * atr, _Digits);
      if(newSl > sl && price - newSl >= minDist) trade.PositionModify(ticket, newSl, tp);
   }
   else
   {
      double price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(open - price < InpTrailStartAtr * atr) return;
      double newSl = NormalizeDouble(price + InpTrailDistAtr * atr, _Digits);
      if((sl == 0.0 || newSl < sl) && newSl - price >= minDist) trade.PositionModify(ticket, newSl, tp);
   }
}

//+------------------------------------------------------------------+
// Break-even: cuando la posicion gana InpBreakEvenAtr veces el ATR, el SL sube a la entrada mas un pequeno colchon
// (InpBreakEvenLockAtr) para que una ganadora no termine en perdida. Se revisa en cada tick.
void ManageBreakEven(ulong ticket, ENUM_POSITION_TYPE ptype)
{
   if(InpBreakEvenAtr <= 0.0 || g_atrCache <= 0.0) return;
   if(!PositionSelectByTicket(ticket)) return;

   double open    = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl      = PositionGetDouble(POSITION_SL);
   double tp      = PositionGetDouble(POSITION_TP);
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double lock    = InpBreakEvenLockAtr * g_atrCache;

   if(ptype == POSITION_TYPE_BUY)
   {
      double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(price - open < InpBreakEvenAtr * g_atrCache) return;
      double newSl = NormalizeDouble(open + lock, _Digits);
      if(newSl > sl && price - newSl >= minDist) trade.PositionModify(ticket, newSl, tp);
   }
   else
   {
      double price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(open - price < InpBreakEvenAtr * g_atrCache) return;
      double newSl = NormalizeDouble(open - lock, _Digits);
      if((sl == 0.0 || newSl < sl) && newSl - price >= minDist) trade.PositionModify(ticket, newSl, tp);
   }
}

//+------------------------------------------------------------------+
// Detecta el cierre de una posicion de este EA: si cerro por SL con perdida y InpFlipOnSL esta activo, deja un volteo
// pendiente (abrir en el sentido contrario). Una operacion ganadora corta la cadena de volteos.
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetString(trans.deal, DEAL_SYMBOL) != _Symbol) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;

   double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT) + HistoryDealGetDouble(trans.deal, DEAL_SWAP);
   long   reason = HistoryDealGetInteger(trans.deal, DEAL_REASON);

   if(profit > 0.0) { g_flipCount = 0; return; }

   if(InpFlipOnSL && reason == DEAL_REASON_SL && g_flipCount < InpMaxFlips)
   {
      // El deal de cierre tiene el tipo contrario a la posicion; abrir en el sentido contrario a la posicion = mismo tipo que ese deal.
      ENUM_DEAL_TYPE dt = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
      g_flipType    = (dt == DEAL_TYPE_SELL) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      g_flipPending = true;
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   ulong ticket;
   ENUM_POSITION_TYPE ptype;
   bool hasPos = FindPosition(ticket, ptype);

   // ---- En cada tick: break-even y volteo pendiente ----
   if(hasPos)
      ManageBreakEven(ticket, ptype);
   else if(g_flipPending)
   {
      g_flipPending = false;
      if(OpenTrade(g_flipType)) g_flipCount++;
      return;
   }

   // Se evalua una sola vez por vela cerrada del marco InpTF.
   datetime bar = iTime(_Symbol, InpTF, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;
   g_atrCache = GetBuf(g_atr, 1);

   int sRaw   = Signal(false);   // cruce sin filtros (para cerrar)
   int sEntry = Signal(true);    // cruce con filtros (para abrir)

   if(hasPos)
   {
      // Cierre por senal contraria (igual que el ejemplo de MetaQuotes).
      bool opposite = (ptype == POSITION_TYPE_BUY && sRaw < 0) || (ptype == POSITION_TYPE_SELL && sRaw > 0);
      if(InpExitOnCross && opposite)
      {
         if(trade.PositionClose(ticket) && InpReverse && sEntry == sRaw)
         {
            g_flipCount = 0;
            OpenTrade(sRaw > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
         }
         return;
      }
      TrailStop(ticket, ptype);
      return;
   }

   // Sin posicion: abrir si hay senal (con filtros).
   if(sEntry != 0) g_flipCount = 0;
   if(sEntry > 0)      OpenTrade(ORDER_TYPE_BUY);
   else if(sEntry < 0) OpenTrade(ORDER_TYPE_SELL);
}
//+------------------------------------------------------------------+
