package expo.modules.liquidglass

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class MenuMorphRowRecord : Record {
  @Field var id: String = ""
  @Field var tag: Int = 0
  @Field var enabled: Boolean = true
  @Field var selected: Boolean = false
  @Field var keepOpen: Boolean = false
  @Field var fullWidth: Boolean = true
}
