(ns uml-viewer.php-language.source-php
  "PHP LanguageSource: open :file and find a method, class-like, or enum case."
  (:require [uml-viewer.source :as source]))

(def ^:private pattern-fmts
  ["function\\s+&?\\s*%s\\s*\\("
   "(?:class|interface|trait|enum)\\s+%s\\b"
   "case\\s+%s\\b"])

(def impl (source/file-source pattern-fmts))

(source/register! :php impl)
