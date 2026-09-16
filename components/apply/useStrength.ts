"use client";

import { useEffect, useMemo, useState } from "react";
import type { Strength } from "@/components/apply/password-rules";

/**
 * Password strength, scored the way Clerk scores it: zxcvbn-ts with the common + English
 * dictionaries. The dictionaries are large, so they load lazily the first time the account step
 * renders and never touch the rest of the site. Returns null while loading or for an empty field.
 */

type Scorer = (pw: string) => Strength;
let scorer: Promise<Scorer> | null = null;

function loadScorer(): Promise<Scorer> {
  if (!scorer) {
    scorer = Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
    ]).then(([core, common, en]) => {
      core.zxcvbnOptions.setOptions({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      });
      return (pw: string) => {
        const r = core.zxcvbn(pw);
        return { score: r.score, warning: r.feedback.warning, suggestions: r.feedback.suggestions };
      };
    });
  }
  return scorer;
}

export function useStrength(password: string): Strength | null {
  const [score, setScore] = useState<Scorer | null>(null);
  useEffect(() => {
    let live = true;
    loadScorer()
      .then((s) => {
        if (live) setScore(() => s);
      })
      .catch(() => {
        /* the checklist simply leaves the strength line pending; Clerk still checks on submit */
      });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => (score && password ? score(password) : null), [score, password]);
}
