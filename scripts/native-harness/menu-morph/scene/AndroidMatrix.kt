package android.graphics

/** Values only: scene fingerprints read matrices, never render pixels. */
class Matrix {
  private val values = floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f)
  fun getValues(destination: FloatArray) { values.copyInto(destination) }
  fun setValue(index: Int, value: Float) { values[index] = value }
}
