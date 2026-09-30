plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.presenter.remote"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.presenter.remote"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }
    // Fixed signing key so every GitHub build installs over the previous one.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
