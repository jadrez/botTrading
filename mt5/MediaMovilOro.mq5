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
//| Una sola posicion a la vez. NO garantiza ganancias: probar en    |
//| el probador y en DEMO antes que nada.                            |
//+------------------------------------------------------------------+
#property version   "1.00"
#property description "Base de media movil para XAUUSD con SL por ATR y lote por riesgo. Probar siempre en demo."

#include <Trade/Trade.mqh>

input group "=== Senal ==="
input ENUM_TIMEFRAMES InpTF             = PERIOD_CURRENT;  // Marco de las velas (CURRENT = el del grafico / probador)
input int             InpMAPeriod       = 12;              // Periodo de la media movil
input ENUM_MA_METHOD  InpMAMethod       = MODE_SMA;        // Tipo de media (SMA, EMA, ...)
input int             InpFilterMAPeriod = 0;               // Filtro de tendencia: periodo de una EMA lenta (0 = apagado)
input bool            InpExitOnCross    = true;            // Cerrar la posicion si aparece la senal contraria
input bool            InpReverse        = true;            // Despues de cerrar por senal contraria, abrir en el otro sentido

input group "=== Riesgo y SL / TP ==="
input double          InpRiskPct        = 1.0;             // % del saldo que se pierde si toca el SL
input int             InpAtrPeriod      = 14;              // Periodo del ATR
input double          InpSLAtr          = 2.0;             // SL = X veces el ATR
input double          InpTPAtr          = 0.0;             // TP = X veces el ATR (0 = sin TP)
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
datetime g_lastBar = 0;

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
int Signal()
{
   double ma = GetBuf(g_ma, 1);
   if(ma <= 0.0) return 0;
   double o = iOpen(_Symbol, InpTF, 1);
   double c = iClose(_Symbol, InpTF, 1);

   int s = 0;
   if(o < ma && c > ma) s = 1;
   else if(o > ma && c < ma) s = -1;
   if(s == 0) return 0;

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

   // Lote para arriesgar InpRiskPct % del saldo con ese SL.
   double riskMoney  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double lossPerLot = LossForMove(1.0, type, price, slDist);
   if(lossPerLot <= 0.0)
   {
      Print("No se pudo calcular el lote (OrderCalcProfit fallo).");
      return false;
   }
   double lot = NormalizeLot(riskMoney / lossPerLot);

   // Si el lote minimo ya arriesga mucho mas de lo pedido, no se abre.
   double actualRisk = LossForMove(lot, type, price, slDist);
   if(actualRisk > riskMoney * InpMaxRiskMult)
   {
      PrintFormat("No se abre: con el lote minimo %.2f el riesgo seria %.2f USD (limite %.2f USD).", lot, actualRisk, riskMoney * InpMaxRiskMult);
      return false;
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
void OnTick()
{
   // Se evalua una sola vez por vela cerrada del marco InpTF.
   datetime bar = iTime(_Symbol, InpTF, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;

   int s = Signal();

   ulong ticket;
   ENUM_POSITION_TYPE ptype;
   if(FindPosition(ticket, ptype))
   {
      // Cierre por senal contraria (igual que el ejemplo de MetaQuotes).
      bool opposite = (ptype == POSITION_TYPE_BUY && s < 0) || (ptype == POSITION_TYPE_SELL && s > 0);
      if(InpExitOnCross && opposite)
      {
         if(trade.PositionClose(ticket) && InpReverse)
            OpenTrade(s > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
      }
      return;
   }

   // Sin posicion: abrir si hay senal.
   if(s > 0)      OpenTrade(ORDER_TYPE_BUY);
   else if(s < 0) OpenTrade(ORDER_TYPE_SELL);
}
//+------------------------------------------------------------------+
