import { useState } from "react";
import type { Selection } from "../../types/models";

export function useSelection() {
  const [selection, setSelection] = useState<Selection>({ type: "none" });
  return { selection, setSelection };
}
