# DAYZO — reglas ProGuard/R8
# Flutter embebe sus propias reglas; aquí solo excepciones específicas.

# flutter_local_notifications usa GSON con genéricos
-keep class com.dexterous.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn com.google.errorprone.annotations.**

# home_widget / Glance
-keep class es.antonborri.home_widget.** { *; }
