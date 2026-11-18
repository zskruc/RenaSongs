package expo.modules.liquidglass

/** Immutable draw-cohort mapping. Material/field origins are screen physical
 * pixels; effect coordinates and padding are pixels in this captured raster. */
internal data class MenuMorphFieldCoordinates(
  val rasterScale: Float,
  val materialOriginX: Float,
  val materialOriginY: Float,
  val fieldOriginX: Float,
  val fieldOriginY: Float,
  val padding: Float = 0f
) {
  init {
    require(rasterScale.isFinite() && rasterScale > 0f)
    require(materialOriginX.isFinite() && materialOriginY.isFinite())
    require(fieldOriginX.isFinite() && fieldOriginY.isFinite() && padding.isFinite())
  }
  val localOriginX get() = materialOriginX - fieldOriginX
  val localOriginY get() = materialOriginY - fieldOriginY
  fun fieldX(rasterX: Float): Float = (rasterX - padding) / rasterScale + localOriginX
  fun fieldY(rasterY: Float): Float = (rasterY - padding) / rasterScale + localOriginY
  fun rasterDistance(physicalDistance: Float): Float = physicalDistance * rasterScale
}
