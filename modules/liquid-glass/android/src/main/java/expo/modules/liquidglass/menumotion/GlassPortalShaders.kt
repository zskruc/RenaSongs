/*
 * SPDX-License-Identifier: MIT
 * Adapted from rit3zh/expo-glass-custom-menu (foreground portal rendering).
 * Source revision: 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 */
package expo.modules.liquidglass.menumotion

private const val SdfFunctions = """
float2 nativeGlassSafeNormal(float2 v) {
    return v / max(length(v), 0.000001);
}
float3 nativeGlassRoundedField(float2 point, float2 halfExtent, float2 radii, float normalMix) {
    if (min(abs(radii.x), abs(radii.y)) <= 0.000001) {
        float2 edge = abs(point) - halfExtent;
        float2 signs = float2(point.x < 0.0 ? -1.0 : 1.0, point.y < 0.0 ? -1.0 : 1.0);
        float2 normal = signs * (edge.x > edge.y ? float2(1.0, 0.0) : float2(0.0, 1.0));
        float2 oval = nativeGlassSafeNormal(float2(point.x, point.y * halfExtent.x / max(halfExtent.y, 0.000001)));
        return float3(max(edge.x, edge.y), nativeGlassSafeNormal(mix(normal, oval, normalMix)));
    }
    float2 r = max(abs(radii), float2(0.001));
    float radius = min(r.x, r.y);
    float2 inverseAxis = radius / r;
    float2 local = point * inverseAxis;
    float2 extent = halfExtent * inverseAxis;
    float expandedRadius = radius * 1.5286649465560913;
    float2 curvature = clamp(2.8915570351735034 -
        1.4457785175867517 * (extent * 2.0) / expandedRadius, 0.0, 1.0);
    float baseRadius = mix(expandedRadius, radius, max(curvature.x, curvature.y));
    float2 edge = abs(local) - extent;
    float2 circle = edge + baseRadius;
    float interior = min(max(circle.x, circle.y), 0.0);
    float2 z = max((edge + expandedRadius) / expandedRadius, 0.0);
    float largest = max(z.x, z.y);
    float t = largest > 0.0 ? clamp(min(z.x, z.y) / largest, 0.0, 1.0) : 0.0;
    float d = length(z);
    float polynomial = ((((-0.926054 * t + 3.15601) * t - 3.64122) * t +
        1.26803) * t + 0.268531) * t * t;
    float raw = d + 1.0 - 1.0 / (1.0 - polynomial * clamp(d, 0.0, 1.0));
    float alternate = 0.3458344340324402 +
        0.6541655659675598 * length(max(1.5286649465560913 * z - 0.528665, 0.0));
    float weight = clamp((z.y > z.x ? 1.0 : -1.0) * (t - 1.0) + 0.5, 0.0, 1.0);
    float corrected = mix(mix(raw, alternate, curvature.x), mix(raw, alternate, curvature.y), weight);
    float distance = interior + expandedRadius * (corrected - 1.0);
    float2 positiveNormal = nativeGlassSafeNormal(max(circle, 0.0));
    if (positiveNormal.x + positiveNormal.y <= 0.0)
        positiveNormal = circle.x > circle.y ? float2(1.0, 0.0) : float2(0.0, 1.0);
    float2 normal = positiveNormal * float2(local.x < 0.0 ? -1.0 : 1.0, local.y < 0.0 ? -1.0 : 1.0);
    float2 oval = nativeGlassSafeNormal(float2(local.x, local.y * extent.x / max(extent.y, 0.000001)));
    normal = nativeGlassSafeNormal(mix(normal, oval, normalMix));
    return float3(distance, normal * inverseAxis);
}
"""
private const val FieldFunctions = SdfFunctions + """
uniform float2 center;
uniform float2 halfSize;
uniform float2 cornerRadii;
uniform float secondaryEnabled;
uniform float2 secondaryCenter;
uniform float2 secondaryHalfSize;
uniform float2 secondaryRadii;
uniform float smoothing;
uniform shader smoothedField;
uniform float smoothedFieldEnabled;
uniform float2 fieldCoordinateScale;
uniform float2 fieldCoordinateOffset;
uniform float2 fieldExtent;
float3 liquidAnalyticFieldGradient(float2 point) {
    float3 a = nativeGlassRoundedField(point - center, halfSize, cornerRadii, 0.5);
    if (secondaryEnabled < 0.5) return a;
    float3 b = nativeGlassRoundedField(point - secondaryCenter, secondaryHalfSize, secondaryRadii, 0.5);
    float k = smoothing * clamp(0.5 - 0.5 * dot(a.yz, b.yz), 0.0, 1.0);
    if (k <= 0.000001) return a.x < b.x ? a : b;
    float h = clamp(0.5 + 0.5 * (a.x - b.x) / k, 0.0, 1.0);
    return float3(mix(a.x, b.x, h) - k * h * (1.0 - h), mix(a.yz, b.yz, h));
}
float3 smoothedFieldSample(float2 pixel) {
    float2 st = pixel - 0.5;
    float2 base = floor(st);
    float2 f = st - base;
    float2 f2 = f * f;
    float2 f3 = f2 * f;
    float2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    float2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    float2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    float2 w3 = f3 / 6.0;
    float2 g0 = w0 + w1;
    float2 g1 = w2 + w3;
    float2 h0 = base + 0.5 + w1 / g0 - 1.0;
    float2 h1 = base + 0.5 + w3 / g1 + 1.0;
    float3 top = float3(smoothedField.eval(float2(h0.x, h0.y)).rgb) * g0.x
        + float3(smoothedField.eval(float2(h1.x, h0.y)).rgb) * g1.x;
    float3 bottom = float3(smoothedField.eval(float2(h0.x, h1.y)).rgb) * g0.x
        + float3(smoothedField.eval(float2(h1.x, h1.y)).rgb) * g1.x;
    return top * g0.y + bottom * g1.y;
}
float3 liquidFieldGradient(float2 point) {
    if (smoothedFieldEnabled > 0.5) {
        float2 pixel = point * fieldCoordinateScale + fieldCoordinateOffset;
        if (pixel.x >= 1.5 && pixel.y >= 1.5 &&
            pixel.x <= fieldExtent.x - 1.5 && pixel.y <= fieldExtent.y - 1.5) {
            return smoothedFieldSample(pixel);
        }
    }
    return liquidAnalyticFieldGradient(point);
}
"""
internal const val GlassForegroundPortalShader = """
uniform shader content;
uniform float2 nodeOrigin;
uniform float height;
uniform float amount;
""" + FieldFunctions + """
half4 main(float2 coord) {
    float2 p = coord + nodeOrigin;
    float3 field = liquidFieldGradient(p);
    float inside = -field.x;
    float aa = max(abs(field.y) + abs(field.z), 0.0001);
    float coverage = inside < -5.0 ? 0.0 : clamp(inside / aa + 0.5, 0.0, 1.0);
    if (coverage < 0.0039215686) return half4(0.0);
    float t = clamp(inside / max(height, 0.0001), 0.0, 1.0);
    float profile = sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
    float innerAA = clamp((height - inside) / aa + 0.5, 0.0, 1.0);
    return content.eval(coord + amount * field.yz * (1.0 - profile) * innerAA) * half(coverage);
}
"""

