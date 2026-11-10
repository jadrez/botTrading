//+------------------------------------------------------------------+
//| PiramideOro.mq5                                                  |
//| Piramide a favor con SL por riesgo (% del saldo) en cada         |
//| posicion. Pensado para XAUUSD en una cuenta Deriv MT5 (HEDGING). |
//|                                                                  |
//| Logica:                                                          |
//|  1) Sin posiciones: al cerrar una vela M1, entra segun el        |
//|     modo (momentum de N velas del mismo color, o vela previa).   |
//|  2) Con posiciones: si el precio avanza InpAddStepPct % a favor  |
//|     desde la ultima entrada, abre otra en la misma direccion.    |
//|  3) Si la ULTIMA posicion cae por debajo de -InpLastNegUSD,      |
//|     cierra TODA la pila.                                         |
//|  4) Trailing opcional de la pila: al llegar a InpTotalArmUSD      |
//|     conserva InpTotalRetainPct % de su pico.                     |
//|  5) Cada posicion lleva SL fijo = InpRiskPct % del saldo.        |
//|                                                                  |
//| NO garantiza ganancias: probar primero en DEMO y en el probador. |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Piramide a favor con SL por riesgo %. Probar siempre en demo primero."

#include <Trade/Trade.mqh>

enum ENUM_ENTRY_MODE
{
   ENTRY_MOMENTUM = 0,   // N velas M1 seguidas del mismo color
   ENTRY_PREV     = 1    // color de la vela M1 anterior
};

input double          InpLot            = 0.05;   // Lote por posicion
input double          InpRiskPct        = 2.0;    // SL por posicion: % del saldo que se pierde si toca el SL
input ENUM_ENTRY_MODE InpEntry          = ENTRY_MOMENTUM; // Modo de entrada
input int             InpMomentumBars   = 3;      // Velas seguidas (modo momentum)
input int             InpMaxPositions   = 5;      // Maximo de posiciones simultaneas
input double          InpAddStepPct     = 0.05;   // Apilar cuando el precio avanza este % a favor (0.05 = 0.05%)
input double          InpLastNegUSD     = 1.0;    // Cierra todo si la ultima posicion cae X USD MAS ALLA del spread
input double          InpTotalArmUSD    = 3.0;    // Trailing de la pila: activar al llegar a +X USD (0 = apagado)
input double          InpTotalRetainPct = 80.0;   // Trailing: conservar este % del pico de la pila
input double          InpMaxSpreadPts   = 0;      // Spread maximo en puntos para abrir (0 = sin limite)
input int             InpStartHour      = 0;      // Hora inicio (hora del servidor) para ABRIR ciclos nuevos
input int             InpEndHour        = 24;     // Hora fin (24 = todo el dia)
input long            InpMagic          = 20261110; // Magic number

CTrade   trade;
double   g_peak    = 0.0;
datetime g_lastBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
   {
      Print("ERROR: esta cuenta no es de tipo HEDGING. La piramide necesita varias posiciones en el mismo simbolo.");
      return(INIT_FAILED);
   }
   if(InpRiskPct <= 0.0 || InpLot <= 0.0)
   {
      Print("ERROR: InpRiskPct e InpLot deben ser mayores que 0.");
      return(INIT_PARAMETERS_INCORRECT);
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);
   PrintFormat("PiramideOro listo en %s. Lote %.2f, SL por posicion = %.1f%% del saldo.", _Symbol, InpLot, InpRiskPct);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
// Datos de la pila de este EA en este simbolo.
// Devuelve el numero de posiciones; llena la direccion, la ultima entrada y la ganancia.
int ReadStack(ENUM_POSITION_TYPE &dir, double &lastOpenPrice, double &lastProfit, double &totalProfit)
{
   int      count    = 0;
   long     lastTime = 0;
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
// Lote normalizado a los limites del simbolo.
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
// Distancia de precio para que, al tocar el SL, se pierda InpRiskPct % del saldo (sin contar comision).
double SlDistance(double lot, ENUM_ORDER_TYPE type, double price)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double p2 = (type == ORDER_TYPE_BUY) ? price - 1.0 : price + 1.0;
   double profit = 0.0;
   if(!OrderCalcProfit(type, _Symbol, lot, price, p2, profit) || profit >= 0.0)
      return 0.0;
   return riskMoney / (-profit);
}

//+------------------------------------------------------------------+
// Costo en USD de cruzar el spread con el lote configurado (una posicion recien abierta ya parte en ese negativo).
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

   double lot   = NormalizeLot(InpLot);
   double price = (type == ORDER_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                                            : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double dist  = SlDistance(lot, type, price);
   if(dist <= 0.0)
   {
      Print("No se pudo calcular la distancia del SL (OrderCalcProfit fallo).");
      return false;
   }

   // Respeta la distancia minima que exige el broker para el SL.
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(dist < minDist) dist = minDist;

   double sl = (type == ORDER_TYPE_BUY) ? price - dist : price + dist;
   sl = NormalizeDouble(sl, _Digits);

   bool ok = trade.PositionOpen(_Symbol, type, lot, price, sl, 0.0, comment);
   if(!ok)
      PrintFormat("Fallo al abrir %s: %s", EnumToString(type), trade.ResultRetcodeDescription());
   return ok;
}

//+------------------------------------------------------------------+
// 1 = compra, -1 = venta, 0 = sin senal (velas M1 ya cerradas).
int EntrySignal()
{
   int n   = (InpEntry == ENTRY_MOMENTUM) ? MathMax(1, InpMomentumBars) : 1;
   int dir = 0;
   for(int i = 1; i <= n; i++)
   {
      double o = iOpen(_Symbol, PERIOD_M1, i);
      double c = iClose(_Symbol, PERIOD_M1, i);
      int d = (c > o) ? 1 : ((c < o) ? -1 : 0);
      if(d == 0) return 0;
      if(i == 1) dir = d;
      else if(d != dir) return 0;
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
void OnTick()
{
   ENUM_POSITION_TYPE dir;
   double lastOpen, lastProfit, total;
   int count = ReadStack(dir, lastOpen, lastProfit, total);

   // ---- Con pila abierta: gestionar ----
   if(count > 0)
   {
      if(total > g_peak) g_peak = total;

      // (3) La ultima posicion entro en negativo: cierra todo.
      // Se descuenta el spread: una posicion recien abierta ya esta en negativo por el spread y no debe cerrar la pila.
      double negLimit = InpLastNegUSD + SpreadCost();
      if(lastProfit < -negLimit)
      {
         CloseAll("la ultima posicion cayo bajo -" + DoubleToString(negLimit, 2) + " USD (incluye spread)");
         g_peak = 0.0;
         return;
      }

      // (4) Trailing de la pila.
      if(InpTotalArmUSD > 0.0 && g_peak >= InpTotalArmUSD && total <= g_peak * InpTotalRetainPct / 100.0)
      {
         CloseAll("trailing de la pila (pico " + DoubleToString(g_peak, 2) + ", ahora " + DoubleToString(total, 2) + ")");
         g_peak = 0.0;
         return;
      }

      // (2) Apilar a favor.
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
      return;
   }

   // ---- Sin pila: buscar entrada al cerrar cada vela M1 ----
   g_peak = 0.0;
   datetime bar = iTime(_Symbol, PERIOD_M1, 0);
   if(bar == g_lastBar) return;   // una sola evaluacion por vela
   g_lastBar = bar;

   if(!InTradingHours()) return;

   int s = EntrySignal();
   if(s > 0)      OpenPosition(ORDER_TYPE_BUY,  "ENTRADA");
   else if(s < 0) OpenPosition(ORDER_TYPE_SELL, "ENTRADA");
}
//+------------------------------------------------------------------+
