package xyz.aethelred.wallet.core.network

/**
 * Closed hierarchy of RPC failures.
 *
 * The top-level sealed class exists so callers can pattern-match without
 * a catch-all `else -> rethrow` — every new failure mode must be added
 * here, keeping the API honest.
 */
public sealed class RpcError(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause) {

    /** Transport layer (DNS, TLS, socket) problem. */
    public class Transport(cause: Throwable) : RpcError("Transport error: ${cause.message}", cause)

    /** The endpoint returned HTTP non-2xx. */
    public class Http(public val status: Int, body: String?) :
        RpcError("HTTP $status from RPC endpoint. body=${body.orEmpty()}")

    /** JSON-RPC error object in the response payload. */
    public class JsonRpc(public val code: Int, public val detail: String) :
        RpcError("JSON-RPC error $code: $detail")

    /** Body wasn't valid JSON or didn't match the expected shape. */
    public class MalformedResponse(cause: Throwable) :
        RpcError("Malformed RPC response: ${cause.message}", cause)

    /** Caller-imposed timeout elapsed before a response arrived. */
    public class Timeout(public val elapsedMs: Long) :
        RpcError("RPC call timed out after ${elapsedMs}ms.")
}
