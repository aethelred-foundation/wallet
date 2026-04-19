package xyz.aethelred.wallet.data.room

import androidx.room.TypeConverter
import java.math.BigInteger

/**
 * Room type converters.
 *
 * Keeps the Kotlin domain using [BigInteger] (for wei amounts) and
 * `List<String>` while Room sticks to primitives on disk.
 */
public class Converters {

    /** Hex (no prefix) round-trip for BigInteger. */
    @TypeConverter
    public fun fromBigInteger(value: BigInteger?): String? = value?.toString(16)

    /** Round-trip from hex back into BigInteger. */
    @TypeConverter
    public fun toBigInteger(value: String?): BigInteger? =
        value?.takeIf { it.isNotBlank() }?.let { BigInteger(it, 16) }

    /** Join a list of strings with a zero-width separator. */
    @TypeConverter
    public fun fromStringList(value: List<String>?): String? =
        value?.joinToString(separator = SEPARATOR)

    /** Split a separator-joined string back into a list. */
    @TypeConverter
    public fun toStringList(value: String?): List<String>? =
        value?.split(SEPARATOR)?.filter { it.isNotEmpty() }

    /** Encode a string→string map as `k=v` pairs. */
    @TypeConverter
    public fun fromStringMap(value: Map<String, String>?): String? =
        value?.entries?.joinToString(separator = SEPARATOR) { "${it.key}=${it.value}" }

    /** Decode a `k=v` packed map. */
    @TypeConverter
    public fun toStringMap(value: String?): Map<String, String>? =
        value?.split(SEPARATOR)
            ?.filter { it.isNotEmpty() }
            ?.associate { entry ->
                val eq = entry.indexOf('=')
                if (eq > 0) entry.substring(0, eq) to entry.substring(eq + 1) else entry to ""
            }

    private companion object {
        /** Unicode Record Separator — unlikely to appear in domain values. */
        private const val SEPARATOR: String = "\u001E"
    }
}
