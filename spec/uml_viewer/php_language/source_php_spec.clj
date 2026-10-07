(ns uml-viewer.php-language.source-php-spec
  (:require [clojure.java.io :as io]
            [speclj.core :refer :all]
            [uml-viewer.php-language.source-php]
            [uml-viewer.source :as source]))

(defn- php-file [tag content]
  (let [dir (io/file (System/getProperty "java.io.tmpdir")
                     (str "uml-php-" tag "-" (System/nanoTime)))
        file (io/file dir "User.php")]
    (io/make-parents file)
    (spit file content)
    file))

(def ^:private user-php
  (str "<?php\n"
       "namespace App\\Domain;\n"
       "\n"
       "final class User\n"
       "{\n"
       "    public function __construct(private Email $email) {}\n"
       "\n"
       "    public static function &rename(string $name): static\n"
       "    {\n"
       "        return $this;\n"
       "    }\n"
       "}\n"
       "\n"
       "enum Role: string\n"
       "{\n"
       "    case Admin = 'admin';\n"
       "}\n"))

(describe "php extractor"
  (it "finds a method and opens the file named on the ident"
    (let [file (php-file "src" user-php)
          found (source/member-source {:lang :php
                                       :ns "App.Domain.User"
                                       :file (.getPath file)
                                       :name "rename"})]
      (should= :php (:lang found))
      (should (re-find #"User\.php:8$" (:title found)))
      (should= 8 (:line found))
      (should (re-find #"function &rename\(string \$name\)" (:body found)))))

  (it "finds a class-like declaration and an enum case"
    (let [file (php-file "decl" user-php)]
      (should= 4 (:line (source/member-source {:lang :php :file (.getPath file) :name "User"})))
      (should= 14 (:line (source/member-source {:lang :php :file (.getPath file) :name "Role"})))
      (should= 16 (:line (source/member-source {:lang :php :file (.getPath file) :name "Admin"})))))

  (it "returns nil when the member is not in the file"
    (let [file (php-file "miss" user-php)]
      (should-be-nil (source/member-source {:lang :php
                                            :file (.getPath file)
                                            :name "missing"}))))

  (it "opens a class at the top when no member is named"
    (let [file (php-file "mod" user-php)
          found (source/member-source {:lang :php
                                       :file (.getPath file)
                                       :ns "App.Domain.User"})]
      (should= (.getPath file) (:file found))
      (should-be-nil (:line found)))))
