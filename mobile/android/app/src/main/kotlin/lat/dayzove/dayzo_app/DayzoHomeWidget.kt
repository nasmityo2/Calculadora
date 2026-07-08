package lat.dayzove.dayzo_app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetPlugin

class DayzoHomeWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (appWidgetId in appWidgetIds) {
            val prefs = HomeWidgetPlugin.getData(context)
            val views = RemoteViews(context.packageName, R.layout.home_widget_layout).apply {
                setTextViewText(
                    R.id.widget_value_binance,
                    prefs.getString("binanceCompra", "--") + " Bs",
                )
                setTextViewText(
                    R.id.widget_value_bcv,
                    prefs.getString("bcv", "--") + " Bs",
                )
                setTextViewText(
                    R.id.widget_timestamp,
                    prefs.getString("timestamp", "--:--"),
                )
            }
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
