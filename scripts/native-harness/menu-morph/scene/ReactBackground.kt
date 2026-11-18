package com.facebook.react.uimanager

import android.view.View

object BackgroundStyleApplicator {
  fun getBackgroundColor(view: View): Int? = view.reactBackgroundColor
}
