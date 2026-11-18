package expo.modules.liquidglass

import android.graphics.Matrix
import android.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection

/** Immutable physical contour; only the committed raster cohort maps pixels. */
internal class MenuMorphFieldShape(physicalScreenPath: Path, private val physicalDensity: Float,
  private val materialOrigin: () -> Offset) : Shape {
  private val physicalPath = Path(physicalScreenPath)
  override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
    val origin = materialOrigin()
    val mapped = Path(physicalPath)
    mapped.offset(-origin.x, -origin.y)
    val matrix = Matrix()
    val scale = density.density / physicalDensity
    matrix.setScale(scale, scale)
    mapped.transform(matrix)
    return Outline.Generic(mapped.asComposePath())
  }
}
