//+------------------------------------------------------------------+
//| PiramideOro.mq5  (v2.00)                                         |
//| EA para XAUUSD en cuenta Deriv MT5 (HEDGING).                    |
//|                                                                  |
//| Entrada (en la vela cerrada del marco InpTF):                    |
//|   - Momentum: N velas seguidas del mismo color, o color de la    |
//|     vela anterior.                                               |
//|   - Filtro de tendencia opcional (EMA del mismo marco).          |
//| Salida:                                                          |
//|   - SL y TP en multiplos del ATR (o SL por % de riesgo del saldo)|
//|     ejecutados por el servidor del broker.                       |
//| Piramide OPCIONAL (InpPyramid): apila a favor y cierra toda la   |
//|     pila si la ultima posicion cae en negativo.                  |
//|                                                                  |
//| NO garantiza ganancias. Probar en el probador y en DEMO.         |
//+------------------------------------------------------------------+
#property version   "2.00"
#property description "XAUUSD: entrada por momentum, SL/TP por ATR, piramide opcional. Probar siempre en demo."

#include <Trade/Trade.mqh>

enum ENUM_ENTRY_MODE
{
   ENTRY_MOMENTUM = 0,   // N velas seguidas del mismo color
   ENTRY_PREV     = 1    // color de la vela anterior
};

input group "=== Senal de entrada ==="
input ENUM_TIMEFRAMES InpTF             = PERIOD_M15;      // Marco de tiempo de las velas
input ENUM_ENTRY_MODE InpEntry          = ENTRY_MOMENTUM;  // Modo de entrada
input int             InpMomentumBars   = 3;               // Velas seguidas (modo momentum)
input int             InpTrendMA        = 0;               // Filtro de tendencia: periodo de la EMA (0 = apagado)

input group "=== Tamano y SL / TP ==="
input double          InpLot            = 0.05;            // Lote fijo
input bool            InpLotByRisk      = false;           // Calcular el lote para arriesgar InpRiskPct del saldo (solo con SL por ATR)
input double          InpRiskPct        = 2.0;             // % del saldo en riesgo por posicion
input bool            InpUseAtrSL       = true;            // true: SL/TP por ATR. false: SL por % de riesgo del saldo, sin TP
input int             InpAtrPeriod      = 14;              // Periodo del ATR
input double          InpSLAtr          = 1.5;             // SL = X veces el ATR
input double          InpTPAtr          = 3.0;             // TP = X veces el ATR (0 = sin TP)

input group "=== Piramide (opcional) ==="
input bool            InpPyramid        = false;           // Apilar posiciones a favor
input int             InpMaxPositions   = 5;               // Maximo de posiciones simultaneas
input double          InpAddStepPct     = 0.05;            // Apilar cuando el precio avanza este % a favor
input double          InpLastNegUSD     = 1.0;             // Cierra todo si la ultima posicion cae X USD mas alla del spread
input double          InpTotalArmUSD    = 3.0;             // Trailing de la pila: activar al llegar a +X USD (0 = apagado)
input double          InpTotalRetainPct = 80.0;            // Trailing: conservar este % del pico

input group "=== Filtros y otros ==="
input double          InpMaxSpreadPts   = 0;               // Spread maximo en puntos para abrir (0 = sin limite)
input int             InpStartHour      = 0;               // Hora inicio (servidor) para abrir ciclos nuevos
input int             InpEndHour        = 24;              // Hora fin (24 = todo el dia)
input long            InpMagic          = 20261110;        // Magic number

CTrade   trade;
double   g_peak    = 0.0;
datetime g_lastBar = 0;
int      g_atr     = INVALID_HANDLE;
int      g_ma      = INVALID_HANDLE;

//+------------------------------------------------------------------+
int OnInit()
{
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
   {
      Print("ERROR: la cuenta no es HEDGING.");
      return(INIT_FAILED);
   }
   if(InpRiskPct <= 0.0 || InpLot <= 0.0)
   {
      Print("ERROR: InpRiskPct e InpLot deben ser mayores que 0.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   g_atr = iATR(_Symbol, InpTF, InpAtrPeriod);
   if(g_atr == INVALID_HANDLE)
   {
      Print("ERROR: no se pudo crear el ATR.");
      return(INIT_FAILED);
   }
   if(InpTrendMA > 0)
   {
      g_ma = iMA(_Symbol, InpTF, InpTrendMA, 0, MODE_EMA, PRICE_CLOSE);
      if(g_ma == INVALID_HANDLE)
      {
         Print("ERROR: no se pudo crear la EMA.");
         return(INIT_FAILED);
      }
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);
   PrintFormat("PiramideOro v2 listo en %s, marco %s, piramide %s.", _Symbol, EnumToString(InpTF), InpPyramid ? "SI" : "NO");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(g_atr != INVALID_HANDLE) IndicatorRelease(g_atr);
   if(g_ma  != INVALID_HANDLE) IndicatorRelease(g_ma);
}

//+------------------------------------------------------------------+
// Valor de un buffer de indicador en la vela 'shift' (0 si falla).
double GetBuf(int handle, int shift)
{
   double buf[];
   if(CopyBuffer(handle, 0, shift, 1, buf) != 1) return 0.0;
   return buf[0];
}

//+------------------------------------------------------------------+
// Datos de la pila de este EA en este simbolo.
int ReadStack(ENUM_POSITION_TYPE &dir, double &lastOpenPrice, double &lastProfit, double &totalProfit)
{
   int  count    = 0;
   long lastTime = 0;
   totalProfit   = 0.0;
   lastProfit    = 0.0;
   lastOpenPrice = 0.0;
   dir           = POSITION_TYPE_BUY;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      count++;
      double p = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      totalProfit += p;

      long t = PositionGetInteger(POSITION_TIME_MSC);
      if(t >= lastTime)
      {
         lastTime      = t;
         lastProfit    = p;
         lastOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         dir           = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      }
   }
   return count;
}

//+------------------------------------------------------------------+
void CloseAll(const string why)
{
   PrintFormat("Cerrando toda la pila: %s", why);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(!trade.PositionClose(ticket))
         PrintFormat("No se pudo cerrar %I64u: %s", ticket, trade.ResultRetcodeDescription());
   }
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

//+------------------------------------------------------------------+
// USD que se pierden con 'lot' lotes si el precio se mueve 'dist' en contra.
double LossForMove(double lot, ENUM_ORDER_TYPE type, double price, double dist)
{
   double p2 = (type == ORDER_TYPE_BUY) ? price - dist : price + dist;
   double profit = 0.0;
   if(!OrderCalcProfit(type, _Symbol, lot, price, p2, profit) || profit >= 0.0) return 0.0;
   return -profit;
}

// Distancia de SL para perder InpRiskPct % del saldo con el lote dado.
double SlDistanceByRisk(double lot, ENUM_ORDER_TYPE type, double price)
{
   double riskMoney   = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double lossPerUnit = LossForMove(lot, type, price, 1.0);
   if(lossPerUnit <= 0.0) return 0.0;
   return riskMoney / lossPerUnit;
}

// Lote para que un SL a 'slDist' pierda InpRiskPct % del saldo.
double LotByRisk(double slDist, ENUM_ORDER_TYPE type, double price)
{
   double riskMoney  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double lossPerLot = LossForMove(1.0, type, price, slDist);
   if(lossPerLot <= 0.0) return NormalizeLot(InpLot);
   return NormalizeLot(riskMoney / lossPerLot);
}

// Costo en USD de cruzar el spread con el lote configurado.
double SpreadCost()
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double profit = 0.0;
   if(!OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, NormalizeLot(InpLot), ask, bid, profit)) return 0.0;
   return (profit < 0.0) ? -profit : 0.0;
}

//+------------------------------------------------------------------+
bool OpenPosition(ENUM_ORDER_TYPE type, const string comment)
{
   if(InpMaxSpreadPts > 0.0)
   {
      double spreadPts = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spreadPts > InpMaxSpreadPts) return false;
   }

   double price = (type == ORDER_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                                            : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double lot    = NormalizeLot(InpLot);
   double slDist = 0.0;
   double tpDist = 0.0;

   if(InpUseAtrSL)
   {
      double atr = GetBuf(g_atr, 1);
      if(atr <= 0.0)
      {
         Print("ATR no disponible todavia.");
         return false;
      }
      slDist = InpSLAtr * atr;
      if(!InpPyramid && InpTPAtr > 0.0) tpDist = InpTPAtr * atr;   // en piramide no se pone TP fijo
      if(InpLotByRisk) lot = LotByRisk(slDist, type, price);
   }
   else
   {
      slDist = SlDistanceByRisk(lot, type, price);
   }

   if(slDist <= 0.0)
   {
      Print("No se pudo calcular la distancia del SL.");
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

   bool ok = trade.PositionOpen(_Symbol, type, lot, price, sl, tp, comment);
   if(!ok)
      PrintFormat("Fallo al abrir %s: %s", EnumToString(type), trade.ResultRetcodeDescription());
   return ok;
}

//+------------------------------------------------------------------+
// 1 = compra, -1 = venta, 0 = sin senal (velas del marco InpTF ya cerradas).
int EntrySignal()
{
   int n   = (InpEntry == ENTRY_MOMENTUM) ? MathMax(1, InpMomentumBars) : 1;
   int dir = 0;
   for(int i = 1; i <= n; i++)
   {
      double o = iOpen(_Symbol, InpTF, i);
      double c = iClose(_Symbol, InpTF, i);
      int d = (c > o) ? 1 : ((c < o) ? -1 : 0);
      if(d == 0) return 0;
      if(i == 1) dir = d;
      else if(d != dir) return 0;
   }

   // Filtro de tendencia: solo en la direccion de la EMA.
   if(InpTrendMA > 0 && g_ma != INVALID_HANDLE)
   {
      double ma    = GetBuf(g_ma, 1);
      double close = iClose(_Symbol, InpTF, 1);
      if(ma <= 0.0) return 0;
      if(dir > 0 && close < ma) return 0;
      if(dir < 0 && close > ma) return 0;
   }
   return dir;
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
void ManagePyramid(int count, ENUM_POSITION_TYPE dir, double lastOpen, double lastProfit, double total)
{
   if(total > g_peak) g_peak = total;

   // La ultima posicion entro en negativo: cierra todo (se descuenta el spread).
   double negLimit = InpLastNegUSD + SpreadCost();
   if(lastProfit < -negLimit)
   {
      CloseAll("la ultima posicion cayo bajo -" + DoubleToString(negLimit, 2) + " USD (incluye spread)");
      g_peak = 0.0;
      return;
   }

   // Trailing de la pila.
   if(InpTotalArmUSD > 0.0 && g_peak >= InpTotalArmUSD && total <= g_peak * InpTotalRetainPct / 100.0)
   {
      CloseAll("trailing de la pila (pico " + DoubleToString(g_peak, 2) + ", ahora " + DoubleToString(total, 2) + ")");
      g_peak = 0.0;
      return;
   }

   // Apilar a favor.
   if(count < InpMaxPositions && lastProfit > 0.0)
   {
      double price = (dir == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                                                 : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double stepPrice = lastOpen * InpAddStepPct / 100.0;
      bool moved = (dir == POSITION_TYPE_BUY) ? (price >= lastOpen + stepPrice)
                                               : (price <= lastOpen - stepPrice);
      if(moved)
         OpenPosition(dir == POSITION_TYPE_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, "PIRAMIDE");
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   ENUM_POSITION_TYPE dir;
   double lastOpen, lastProfit, total;
   int count = ReadStack(dir, lastOpen, lastProfit, total);

   // ---- Con posiciones abiertas ----
   if(count > 0)
   {
      if(InpPyramid) ManagePyramid(count, dir, lastOpen, lastProfit, total);
      // Sin piramide: el SL y el TP del broker cierran la posicion.
      return;
   }

   // ---- Sin posiciones: buscar entrada al cerrar cada vela del marco InpTF ----
   g_peak = 0.0;
   datetime bar = iTime(_Symbol, InpTF, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;

   if(!InTradingHours()) return;

   int s = EntrySignal();
   if(s > 0)      OpenPosition(ORDER_TYPE_BUY,  "ENTRADA");
   else if(s < 0) OpenPosition(ORDER_TYPE_SELL, "ENTRADA");
}
//+------------------------------------------------------------------+
