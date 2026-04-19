package xyz.aethelred.wallet.ui.screens

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.StatusBadge
import xyz.aethelred.wallet.ui.components.StatusKind
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Rendered tx detail. Keeps display concerns in one place; the ViewModel
 * maps a `StoredTransactionEntity` into this.
 */
public data class TxDetailUi(
    public val hash: String,
    public val status: StatusKind,
    public val blockNumber: Long?,
    public val nonce: String,
    public val gasUsed: String,
    public val gasPrice: String,
    public val totalFee: String,
    public val explorerUrl: String,
    public val memo: String?,
)

/**
 * Full transaction detail screen.
 *
 * Renders:
 *  * Hash + status pill.
 *  * Gas breakdown: used, price, total fee.
 *  * Block + nonce.
 *  * Open-in-explorer + share-receipt actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun TxDetailScreen(
    detail: TxDetailUi,
    onBack: () -> Unit,
) {
    val context = LocalContext.current

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.tx_detail_title),
                onBack = onBack,
                actions = {
                    IconButton(onClick = { shareReceipt(context, detail) }) {
                        Icon(
                            IconTokens.Share,
                            contentDescription = stringResource(R.string.tx_detail_share),
                        )
                    }
                },
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Row {
                        Text(
                            text = stringResource(R.string.tx_detail_hash),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        StatusBadge(status = detail.status)
                    }
                    Text(
                        text = detail.hash,
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    )
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    DetailRow(stringResource(R.string.tx_detail_block), detail.blockNumber?.toString() ?: "—")
                    DetailRow(stringResource(R.string.tx_detail_nonce), detail.nonce)
                    DetailRow(stringResource(R.string.tx_detail_gas_used), detail.gasUsed)
                    DetailRow(stringResource(R.string.tx_detail_gas_price), detail.gasPrice)
                    DetailRow(stringResource(R.string.tx_detail_total_fee), detail.totalFee)
                    detail.memo?.let { DetailRow("Memo", it) }
                }
            }

            OutlinedButton(
                onClick = { openExplorer(context, detail.explorerUrl) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(IconTokens.OpenInNew, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.tx_detail_open_explorer))
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

private fun openExplorer(context: android.content.Context, url: String) {
    val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
    context.startActivity(intent)
}

private fun shareReceipt(context: android.content.Context, detail: TxDetailUi) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(
            Intent.EXTRA_TEXT,
            "${detail.hash}\n${detail.explorerUrl}",
        )
    }
    context.startActivity(Intent.createChooser(intent, detail.hash))
}
