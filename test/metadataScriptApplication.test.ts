import assert from 'node:assert/strict';
import { existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url),plugin=require('../plugins/withNetworkRecovery.js');
const root=new URL('../',import.meta.url).pathname;
const generatedPath=new URL('../android/app/src/main/java/com/zskruc/resonus/glasspreview/MainApplication.kt',import.meta.url);
// Fresh clones need no prebuild merely to run this regression. The fixture is
// the unchanged SDK57 template captured from the generated application.
const application=readFileSync(existsSync(generatedPath)?generatedPath:new URL('./fixtures/Expo57MainApplication.kt',import.meta.url),'utf8');
function assertFirstGuard(value:string){const create=value.slice(value.indexOf('override fun onCreate'),value.indexOf('override fun onConfigurationChanged'));assert.match(create,/super\.onCreate\(\)\s*\n\s*if \(isMetadataParserIsolatedProcess\(\)\) return/);for(const call of ['NetworkRecovery.install','HighRefresh.install','loadReactNative','onApplicationCreate'])if(create.includes(call))assert.ok(create.indexOf('if (isMetadataParserIsolatedProcess()) return')<create.indexOf(call),call);assert.match(value,/super\.onConfigurationChanged\(newConfig\)\s*\n\s*if \(isMetadataParserIsolatedProcess\(\)\) return/);}
test('real generated MainApplication gains first-entry parser guards and remains prebuild-idempotent',()=>{const output=plugin.applyInstall(application);assertFirstGuard(output);assert.equal(plugin.applyInstall(output),output);assert.equal(output.split('private fun isMetadataParserIsolatedProcess()').length,2);assert.match(output,/processName == parserPrefix \|\| processName\.startsWith\(parserPrefix \+ ":"\)/);});
test('actual Expo plugin mod order keeps parser guard before network/high-refresh on repeated prebuilds',async()=>{const app=JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8')).expo;const plugins=app.plugins.filter((entry:unknown)=>typeof entry==='string'&&/withNetworkRecovery|withHighRefresh/.test(entry));assert.equal(plugins.length,2);let config:any={name:'Bootstrap',slug:'bootstrap'};for(const name of plugins)config=require('../'+name)(config);let result=await config.mods.android.mainApplication({...config,modResults:{language:'kt',contents:application},modRequest:{projectRoot:root,platformProjectRoot:join(root,'android'),platform:'android',modName:'mainApplication',introspect:true}});assertFirstGuard(result.modResults.contents);const first=result.modResults.contents;result=await config.mods.android.mainApplication({...config,modResults:{language:'kt',contents:first},modRequest:{projectRoot:root,platformProjectRoot:join(root,'android'),platform:'android',modName:'mainApplication',introspect:true}});assert.equal(result.modResults.contents,first);});
test('changed/non-Kotlin entry templates fail closed instead of silently dropping initialization guard',()=>{assert.throws(()=>plugin.applyInstall('class Other {}'),/onCreate anchor/);});
test('actual generated Kotlin bootstraps parser without app services, while normal app/config initialization stays intact',(context)=>{
 const cache=join(root,'node_modules/.cache/native-harness/m2');
 if(!existsSync(cache)){context.skip('Install the existing native-harness Kotlin toolchain to run this additional JVM check');return;}
 const classpath=readdirSync(cache).filter(file=>file.endsWith('.jar')).map(file=>join(cache,file)).join(':');
 if(!classpath.includes('kotlin-compiler')||spawnSync('java',['-version'],{encoding:'utf8'}).status!==0){context.skip('Native bootstrap check requires the existing Kotlin/JVM harness');return;}
 const out=join(root,'.local-cache/metadata-script-171/application-bootstrap','test-'+process.pid),src=join(out,'src'),classes=join(out,'classes');mkdirSync(src,{recursive:true});mkdirSync(classes,{recursive:true});
 const generated=plugin.applyInstall(application),pkg=/^package (\S+)/m.exec(generated)![1];const files:Record<string,string>={
 'MainApplication.kt':generated,
 'Probe.kt':`package bootstrap
object Probe { var packageName="${pkg}";var processName="";var uid=10001;var appUid=10001;var isolated=false;val events=mutableListOf<String>();fun reset(){events.clear();uid=10001;appUid=10001;isolated=false;processName=packageName;android.os.Build.VERSION.SDK_INT=36} }
fun main(){
 fun guard(app:${pkg}.MainApplication):Boolean{val method=app.javaClass.getDeclaredMethod("isMetadataParserIsolatedProcess");method.isAccessible=true;return method.invoke(app) as Boolean}
 var checks=0
 for(suffix in listOf(":metadata_parser",":metadata_parser:expo.modules.metadatascript.ScriptService")){Probe.reset();Probe.isolated=true;Probe.uid=99001;Probe.processName=Probe.packageName+suffix;val app=${pkg}.MainApplication();app.onCreate();check(Probe.events==listOf("superCreate"));app.onConfigurationChanged(android.content.res.Configuration());check(Probe.events==listOf("superCreate","superConfig"));checks+=2}
 Probe.reset();val main=${pkg}.MainApplication();main.onCreate();check(Probe.events==listOf("superCreate","network","refresh","react","host","expoCreate"));main.onConfigurationChanged(android.content.res.Configuration());check(Probe.events.takeLast(2)==listOf("superConfig","expoConfig"));checks+=2
 for(name in listOf(Probe.packageName,Probe.packageName+":metadata_parser_other",Probe.packageName+":other","other.package:metadata_parser")){Probe.reset();Probe.isolated=true;Probe.uid=99001;Probe.processName=name;check(!guard(${pkg}.MainApplication()));checks++}
 Probe.reset();Probe.processName+=":metadata_parser";check(!guard(${pkg}.MainApplication()));checks++
 Probe.reset();android.os.Build.VERSION.SDK_INT=27;${pkg}.MainApplication().onCreate();check(Probe.events.contains("expoCreate"));checks++
 println("Actual generated MainApplication bootstrap: $checks checks passed")
}`,
 'Application.kt':`package android.app
open class Application {val packageName get()=bootstrap.Probe.packageName;val applicationContext:Any get()=this;val applicationInfo get()=ApplicationInfo();open fun onCreate(){bootstrap.Probe.events.add("superCreate")};open fun onConfigurationChanged(config:android.content.res.Configuration){bootstrap.Probe.events.add("superConfig")};companion object {@JvmStatic fun getProcessName():String {check(android.os.Build.VERSION.SDK_INT>=28);return bootstrap.Probe.processName}}}
class ApplicationInfo {val uid get()=bootstrap.Probe.appUid}`,
 'AndroidOs.kt':`package android.os
object Build {object VERSION {var SDK_INT=36}}
object Process {fun isIsolated():Boolean{check(Build.VERSION.SDK_INT>=28);return bootstrap.Probe.isolated};fun myUid()=bootstrap.Probe.uid}`,
 'Configuration.kt':`package android.content.res
class Configuration`,
 'React.kt':`package com.facebook.react
interface ReactApplication {val reactHost:ReactHost};interface ReactPackage;class ReactHost;class PackageList(app:Any) {val packages=mutableListOf<ReactPackage>()}
object ReactNativeApplicationEntryPoint {fun loadReactNative(app:Any){bootstrap.Probe.events.add("react");(app as ReactApplication).reactHost}}`,
 'ReleaseLevel.kt':`package com.facebook.react.common
enum class ReleaseLevel { STABLE }`,
 'NewArchitecture.kt':`package com.facebook.react.defaults
object DefaultNewArchitectureEntryPoint {var releaseLevel=com.facebook.react.common.ReleaseLevel.STABLE}`,
 'Expo.kt':`package expo.modules
object ExpoReactHostFactory {fun getDefaultReactHost(context:Any,packageList:List<com.facebook.react.ReactPackage>):com.facebook.react.ReactHost {bootstrap.Probe.events.add("host");return com.facebook.react.ReactHost()}}
object ApplicationLifecycleDispatcher {fun onApplicationCreate(app:Any){bootstrap.Probe.events.add("expoCreate")};fun onConfigurationChanged(app:Any,config:android.content.res.Configuration){bootstrap.Probe.events.add("expoConfig")}}`,
 'Network.kt':`package expo.modules.networkrecovery
object NetworkRecovery {fun install(app:Any){check(!bootstrap.Probe.isolated);bootstrap.Probe.events.add("network")}}`,
 'Refresh.kt':`package expo.modules.highrefresh
object HighRefresh {fun install(app:Any){check(!bootstrap.Probe.isolated);bootstrap.Probe.events.add("refresh")}}`,
 'BuildConfig.kt':`package ${pkg}
object BuildConfig {const val REACT_NATIVE_RELEASE_LEVEL="stable"}`,
 };
 const paths=Object.entries(files).map(([name,value])=>{const path=join(src,name);writeFileSync(path,value);return path;});assert.match(classpath,/kotlin-compiler/);
 const compile=spawnSync('java',['-cp',classpath,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-jvm-target','17','-cp',classpath,'-d',classes,...paths],{cwd:root,encoding:'utf8',timeout:60000});writeFileSync(join(out,'compile.log'),compile.stdout+compile.stderr);assert.equal(compile.status,0,compile.stdout+compile.stderr);
 const run=spawnSync('java',['-cp',classes+':'+classpath,'bootstrap.ProbeKt'],{cwd:root,encoding:'utf8',timeout:10000});writeFileSync(join(out,'run.log'),run.stdout+run.stderr);assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/12 checks passed/);
});
