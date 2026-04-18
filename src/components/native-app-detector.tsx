"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// Capacitorネイティブアプリの場合に body に .native-app クラスを付与する。
// globals.css で font-size: 17px を適用するために使用。
export function NativeAppDetector() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      document.body.classList.add("native-app");
    }
  }, []);
  return null;
}
