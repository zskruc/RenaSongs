/*
 * SPDX-License-Identifier: MIT
 * Press pool/lift/rim contribution adapted from GlassMenuSession.applyLight
 * and GlassShaders in rit3zh/expo-glass-custom-menu
 * @0021efd8ab0d068f155bbdac62c5f673ccc39a24. The unpressed Kyant recipe is unchanged.
 */
package expo.modules.liquidglass

import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RuntimeShader
import androidx.annotation.RequiresApi

/** Add only the original transient light contribution, within the raster material. */
@RequiresApi(33)
internal class MenuPressLight {
  private val shader = RuntimeShader(Source)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { blendMode = BlendMode.PLUS }
  fun draw(canvas: Canvas, width: Float, height: Float, radius: Float, density: Float,
    rasterScale: Float, x: Float, y: Float, glow: Float, trigger: Boolean = false) {
    if (glow <= .001f || width <= 0f || height <= 0f) return
    shader.setFloatUniform("extent", width / rasterScale, height / rasterScale)
    shader.setFloatUniform("radius", radius)
    shader.setFloatUniform("density", density)
    shader.setFloatUniform("rasterScale", rasterScale)
    shader.setFloatUniform("press", x, y, (if (trigger) 38f else 80f) * density,
      (if (trigger) .07f else .03f) * glow)
    shader.setFloatUniform("pressLift", (if (trigger) .055f else .018f) * glow)
    shader.setFloatUniform("rimLift", (if (trigger) .3f else .12f) * glow)
    paint.shader = shader
    canvas.drawRect(0f, 0f, width, height, paint)
  }
  private companion object {
    const val Source = """
uniform float2 extent;
uniform float radius;
uniform float density;
uniform float rasterScale;
uniform float4 press;
uniform float pressLift;
uniform float rimLift;
float distanceToShape(float2 p) {
    float r = min(radius, min(extent.x, extent.y) * .5);
    float2 q = abs(p - extent * .5) - extent * .5 + r;
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
float nativeHighlightStrip(float depth, float height, float curvature, float aa) {
    float u = clamp(depth / max(height, 0.000001), 0.0, 1.0);
    float profile = mix(u < 1.0 ? 1.0 : 0.0, 1.0 - u, curvature);
    return profile * clamp(depth / aa + 0.5, 0.0, 1.0)
        * clamp((height - depth) / aa + 0.5, 0.0, 1.0);
}
half4 main(float2 coord) {
    float2 p = coord / rasterScale;
    float sdf = distanceToShape(p);
    float2 grad = float2(distanceToShape(p + float2(.5, 0.0)) - distanceToShape(p - float2(.5, 0.0)),
        distanceToShape(p + float2(0.0, .5)) - distanceToShape(p - float2(0.0, .5)));
    float aa = max(abs(grad.x) + abs(grad.y), .0001);
    float coverage = clamp(.5 - sdf / aa, 0.0, 1.0);
    float2 v = p - press.xy;
    float pool = exp(-dot(v, v) / (2.0 * press.z * press.z));
    float strip = nativeHighlightStrip(-sdf, density, .75, aa);
    float light = (pressLift + pool * press.w) * coverage
        + rimLift * (.45 + .55 * pool) * strip;
    return half4(half3(light), 0.0);
}
"""
  }
}
