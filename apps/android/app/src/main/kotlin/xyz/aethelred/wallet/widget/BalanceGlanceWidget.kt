package xyz.aethelred.wallet.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import kotlinx.coroutines.flow.first

/**
 * Home-screen widget rendered by Glance.
 *
 * Shows the wallet's portfolio value and a "tap to open" prompt.
 *
 * The widget deliberately does NOT touch the AndroidKeyStore — widget
 * processes are short-lived and can't participate in a signing flow.
 * Instead, a [DataStore] owns the display-ready balance string; the
 * foreground app is responsible for writing the latest snapshot via
 * [writeWidgetSnapshot].
 */
public class BalanceGlanceWidget : GlanceAppWidget() {

    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = context.readSnapshot()
        provideContent {
            GlanceTheme {
                BalanceContent(snapshot)
            }
        }
    }

    @Composable
    private fun BalanceContent(snapshot: BalanceWidgetSnapshot) {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = snapshot.balanceFormatted,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurface,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = snapshot.symbol,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurfaceVariant,
                    fontSize = 14.sp,
                ),
            )
        }
    }
}

/** Display-ready snapshot persisted into the widget's DataStore. */
public data class BalanceWidgetSnapshot(
    public val balanceFormatted: String,
    public val symbol: String,
)

/** DataStore used to back the widget. */
private val Context.widgetDataStore: DataStore<Preferences> by preferencesDataStore("aethelred_widget")

private val KEY_BALANCE = stringPreferencesKey("balance")
private val KEY_SYMBOL = stringPreferencesKey("symbol")

private suspend fun Context.readSnapshot(): BalanceWidgetSnapshot {
    val prefs = widgetDataStore.data.first()
    return BalanceWidgetSnapshot(
        balanceFormatted = prefs[KEY_BALANCE] ?: "-",
        symbol = prefs[KEY_SYMBOL] ?: "USD",
    )
}

/**
 * Public entry the main app uses to push the latest balance into the
 * widget's DataStore. Call from the balance-refresh worker.
 */
public suspend fun Context.writeWidgetSnapshot(snapshot: BalanceWidgetSnapshot) {
    widgetDataStore.edit { prefs ->
        prefs[KEY_BALANCE] = snapshot.balanceFormatted
        prefs[KEY_SYMBOL] = snapshot.symbol
    }
}
