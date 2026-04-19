# Aethelred Wallet — ProGuard / R8 rules.
#
# Keep the conservative set of rules required by the wallet's runtime
# reflection needs (Hilt generated classes, kotlinx.serialization generated
# `$serializer` objects, Keystore reflection inside androidx.security).
# Everything else is free to shrink.

# --- General Kotlin / Coroutines ---
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** { volatile <fields>; }

# --- kotlinx.serialization ---
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}

# --- Hilt / Dagger ---
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.internal.GeneratedComponentManager { *; }
-keep class androidx.hilt.** { *; }

# --- OkHttp (platform & conscrypt fallbacks) ---
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Biometric / Keystore reflection ---
-keep class javax.crypto.** { *; }
-keep class java.security.** { *; }
-keepclassmembers class android.security.keystore.** { *; }

# --- Compose debug utilities stripped in release ---
-assumenosideeffects class androidx.compose.runtime.ComposerKt {
    void sourceInformation(androidx.compose.runtime.Composer,java.lang.String);
    void sourceInformationMarkerStart(androidx.compose.runtime.Composer,int,java.lang.String);
    void sourceInformationMarkerEnd(androidx.compose.runtime.Composer);
}

# --- Wallet domain models survive obfuscation so audit events decode cleanly ---
-keep class xyz.aethelred.wallet.core.audit.** { *; }
-keep class xyz.aethelred.wallet.core.identity.** { *; }
-keep class xyz.aethelred.wallet.core.network.NetworkDefinition { *; }
