const { withMainApplication } = require('@expo/config-plugins');

const INSTALL = 'expo.modules.networkrecovery.NetworkRecovery.install(this)';
const GUARD = 'if (isMetadataParserIsolatedProcess()) return';
const HELPER = `
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
          if (count > 0) String(bytes, 0, count, Charsets.UTF_8).substringBefore('\\u0000') else ""
        }
      } catch (_: Exception) { "" }
    }
    val parserPrefix = packageName + ":metadata_parser"
    // Some Android releases append the isolated service's class name.
    return processName == parserPrefix || processName.startsWith(parserPrefix + ":")
  }
`;

function applyInstall(source) {
  const anchor = /(override\s+fun\s+onCreate\s*\(\s*\)\s*\{\s*\n\s*super\.onCreate\s*\(\s*\))/;
  if (!anchor.test(source)) {
    throw new Error('withNetworkRecovery: Kotlin MainApplication.onCreate anchor was not found');
  }
  // Reposition our guard on every prebuild. Existing generated files can
  // already contain HighRefresh/NetworkRecovery inserted after super.
  let result = source.replace(/^[ \t]*if \(isMetadataParserIsolatedProcess\(\)\) return\r?\n/gm, '');
  result = result.replace(anchor, `$1\n    ${GUARD}`);
  if (!result.includes(INSTALL)) result = result.replace(GUARD, `${GUARD}\n    ${INSTALL}`);
  result = result.replace(/(override\s+fun\s+onConfigurationChanged\s*\([^)]*\)\s*\{\s*\n\s*super\.onConfigurationChanged\s*\([^)]*\))/, `$1\n    ${GUARD}`);
  if (!result.includes('private fun isMetadataParserIsolatedProcess()')) {
    if (!/\n}\s*$/.test(result)) throw new Error('withNetworkRecovery: MainApplication class closing anchor was not found');
    result = result.replace(/\n}(\s*)$/, `${HELPER}\n}$1`);
  }
  return result;
}

module.exports = function withNetworkRecovery(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withNetworkRecovery requires Kotlin MainApplication');
    }
    cfg.modResults.contents = applyInstall(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applyInstall = applyInstall;
