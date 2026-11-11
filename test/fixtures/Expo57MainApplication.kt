package com.zskruc.resonus.glasspreview

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (isMetadataParserIsolatedProcess()) return
    expo.modules.networkrecovery.NetworkRecovery.install(this)
    expo.modules.highrefresh.HighRefresh.install(this)
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (isMetadataParserIsolatedProcess()) return
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
  // An isolated parser has no app permissions or connectivity service. Its
  // Application must not initialize NetworkRecovery, Expo, or React Native.
  private fun isMetadataParserIsolatedProcess(): Boolean {
    val isolated = if (android.os.Build.VERSION.SDK_INT >= 28) {
      android.os.Process.isIsolated()
    } else {
      android.os.Process.myUid() != applicationInfo.uid
    }
    if (!isolated) return false
    val processName = if (android.os.Build.VERSION.SDK_INT >= 28) {
      android.app.Application.getProcessName()
    } else {
      try {
        java.io.File("/proc/self/cmdline").inputStream().use { stream ->
          val bytes = ByteArray(512)
          val count = stream.read(bytes)
          if (count > 0) String(bytes, 0, count, Charsets.UTF_8).substringBefore('\u0000') else ""
        }
      } catch (_: Exception) { "" }
    }
    val parserPrefix = packageName + ":metadata_parser"
    // Some Android releases append the isolated service's class name.
    return processName == parserPrefix || processName.startsWith(parserPrefix + ":")
  }

}
