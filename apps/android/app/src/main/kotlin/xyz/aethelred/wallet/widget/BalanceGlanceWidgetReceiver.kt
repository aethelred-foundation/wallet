package xyz.aethelred.wallet.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * Broadcast-receiver entry point for the [BalanceGlanceWidget].
 *
 * Registered in `AndroidManifest.xml` with the `APPWIDGET_UPDATE` intent
 * filter; lifecycle callbacks (enabled / disabled / update) are handled
 * by Glance's base class.
 */
public class BalanceGlanceWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BalanceGlanceWidget()
}
