(ns uml-viewer.php-language.graph-php
  "PHP LanguageGraph: one class per class, interface, trait, or enum.
  `php/scan.php` parses each file with nikic/php-parser and reports
  declarations and references as JSON. `facts->graph` turns those facts
  into classes and edges."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [uml-viewer.graph :as graph]))

(def ^:private skip-dir-names
  #{"vendor" "node_modules" "tests" "Tests" "test" "var" "cache"
    "build" "dist"})

(defn- skip-dir? [name]
  (or (str/starts-with? name ".")
      (contains? skip-dir-names name)))

(defn- excluded-name? [name]
  (boolean (re-find #"Test\.php$" name)))

(defn source-files
  "PHP files under `root`, sorted. Skips vendor, tests, and `*Test.php`."
  [root]
  (let [root (.getCanonicalFile (io/file root))]
    (->> (tree-seq (fn [f]
                     (and (.isDirectory f)
                          (or (= f root) (not (skip-dir? (.getName f))))))
                   (fn [dir] (vec (.listFiles dir)))
                   root)
         (filter #(.isFile %))
         (filter #(str/ends-with? (.getName %) ".php"))
         (remove #(excluded-name? (.getName %)))
         (sort-by #(.getPath %)))))

(defn- tool-root
  "The uml-viewer checkout when `src` is a directory on the classpath."
  []
  (when-let [url (io/resource "uml_viewer/graph.clj")]
    (when (= "file" (.getProtocol url))
      (-> (io/file (.toURI url)) .getParentFile .getParentFile .getParentFile))))

(defn scanner-path
  "Path to `scan.php`: `:scanner` in `opts`, then `UML_VIEWER_PHP_SCANNER`,
  then `php/scan.php` in this checkout."
  [opts]
  (str (or (:scanner opts)
           (System/getenv "UML_VIEWER_PHP_SCANNER")
           (io/file (or (tool-root) (io/file ".")) "php" "scan.php"))))

(defn- php-binary [opts]
  (or (:php opts) (System/getenv "UML_VIEWER_PHP") "php"))

(defn- start-scanner [cmd]
  (try
    (.start (ProcessBuilder. ^java.util.List cmd))
    (catch java.io.IOException e
      (throw (ex-info (str "PHP scanner needs `php` on PATH (or UML_VIEWER_PHP): "
                           (.getMessage e))
                      {:cmd cmd} e)))))

(defn- daemon
  "Run `f` on a daemon thread. A `future` would keep the JVM alive after
  `-main` returns. Returns a promise of the result."
  [f]
  (let [result (promise)]
    (doto (Thread. ^Runnable (fn [] (deliver result (f))))
      (.setDaemon true)
      (.start))
    result))

(defn read-facts
  "Run `scan.php` over `files`. Returns `{:files [...]}` with keyword keys."
  [files opts]
  (if (empty? files)
    {:files []}
    (let [cmd [(php-binary opts) (scanner-path opts)]
          p (start-scanner cmd)
          err (daemon #(slurp (.getErrorStream p)))]
      (daemon #(with-open [w (io/writer (.getOutputStream p))]
                 (doseq [f files]
                   (.write w (str (.getCanonicalPath (io/file f)) "\n")))))
      (let [out (slurp (.getInputStream p))
            exit (.waitFor p)]
        (when-not (zero? exit)
          (throw (ex-info (str "PHP scanner failed (exit " exit "): " (str/trim @err))
                          {:cmd cmd :exit exit})))
        (json/read-str out :key-fn keyword)))))

(defn dotted
  "`App\\Domain\\User` as `App.Domain.User`."
  [fqn]
  (str/replace (str/replace (str fqn) #"^\\+" "") "\\" "."))

(defn- php-ns
  "Namespace of the class `fqn` under `ns-prefix`. A name that already
  begins with the prefix stays as written."
  [fqn ns-prefix]
  (let [d (dotted fqn)]
    (cond
      (str/blank? ns-prefix) d
      (or (= d ns-prefix) (str/starts-with? d (str ns-prefix "."))) d
      :else (str ns-prefix "." d))))

(def ^:private stereotypes
  {"interface" :interface
   "trait" :trait
   "enum" :enumeration})

(defn- stereotype-of [decl]
  (or (get stereotypes (:kind decl))
      (when (:abstract decl) :abstract)))

(def ^:private visibility-marks
  {"public" "+" "protected" "#" "private" "-"})

(defn- property-text [p]
  (str (get visibility-marks (:visibility p) "+") " "
       (:name p)
       (when (:type p) (str " : " (:type p)))
       (cond
         (and (:static p) (:readonly p)) " {static, readOnly}"
         (:static p) " {static}"
         (:readonly p) " {readOnly}")))

(defn- param-text [p]
  (str (when (:variadic p) "...")
       (when (:byRef p) "&")
       (:name p)
       (when (:type p) (str ": " (:type p)))))

(defn- method-text [m]
  (str (:name m)
       "(" (str/join ", " (map param-text (:params m))) ")"
       (when (:returns m) (str " : " (:returns m)))))

(defn- fields-of [decl]
  (vec (concat
         (map (fn [c] {:name (:name c) :text (:name c)}) (:cases decl))
         (map (fn [p] {:name (:name p) :text (property-text p)}) (:properties decl)))))

(defn- ops-of [decl]
  (mapv (fn [m]
          (cond-> {:name (:name m) :text (method-text m)}
            (not= "public" (:visibility m)) (assoc :private true)))
        (:methods decl)))

(defn- declarations
  "Each declaration with its file. A class declared twice keeps the
  first file in path order."
  [files]
  (let [decls (for [f files
                    d (:declarations f)]
                (assoc d :file (:file f)))]
    (->> decls
         (reduce (fn [{:keys [seen acc]} d]
                   (let [k (str/lower-case (:name d))]
                     (if (seen k)
                       {:seen seen :acc acc}
                       {:seen (conj seen k) :acc (conj acc d)})))
                 {:seen #{} :acc []})
         :acc)))

(defn- class-of [decl id ns-str]
  (let [fields (fields-of decl)
        ops (ops-of decl)
        st (stereotype-of decl)]
    (cond-> {:id id
             :name (:short decl)
             :ns ns-str
             :lang :php
             :file (graph/relative-path (:file decl))}
      st (assoc :stereotype st)
      (seq fields) (assoc :fields fields)
      (seq ops) (assoc :ops ops))))

(defn- resolver
  "Fn from a class name to its id. PHP class names ignore case.
  Unknown names are foreign, keyed by the dotted name."
  [index]
  (fn [fqn]
    (or (get index (str/lower-case (str/replace (str fqn) #"^\\+" "")))
        (keyword (dotted fqn)))))

(defn- decl-edges [decl from resolve]
  (concat
    (map (fn [n] {:from from :to (resolve n) :kind :inheritance}) (:extends decl))
    (map (fn [n] {:from from :to (resolve n) :kind :implements}) (:implements decl))
    (map (fn [n] {:from from :to (resolve n) :kind :inheritance :label "use"})
         (:traits decl))
    (map (fn [n] {:from from :to (resolve n) :kind :dependency})
         (distinct (map :name (:deps decl))))))

(defn- warn-errors! [files]
  (doseq [f files
          e (:errors f)]
    (binding [*out* *err*]
      (println (str "PHP parse error in " (graph/relative-path (:file f)) ": " e)))))

(defn facts->graph
  "Classes and edges from `scan.php` file facts.
  `opts` has `:prefix` (stripped from ids) and `:ns-prefix` (the tree root)."
  [files {:keys [prefix ns-prefix]}]
  (let [prefix (or prefix "App")
        ns-prefix (or ns-prefix prefix)
        decls (mapv (fn [d]
                      (let [ns-str (php-ns (:name d) ns-prefix)]
                        (assoc d :ns ns-str :id (graph/id-of ns-str prefix))))
                    (declarations files))
        index (into {} (map (fn [d] [(str/lower-case (:name d)) (:id d)]) decls))
        resolve (resolver index)
        classes (mapv #(class-of % (:id %) (:ns %)) decls)
        project-ids (set (map :id classes))
        edges (->> decls
                   (mapcat #(decl-edges % (:id %) resolve))
                   (remove #(= (:from %) (:to %)))
                   distinct
                   vec)
        foreigns (->> edges
                      (map :to)
                      (remove project-ids)
                      distinct
                      (mapv graph/foreign-class))]
    {:classes (into classes foreigns)
     :edges edges}))

(defrecord PhpGraph []
  graph/LanguageGraph
  (scan [_ root opts]
    (let [files (:files (read-facts (source-files root) opts))]
      (warn-errors! files)
      (facts->graph files opts))))

(def impl (->PhpGraph))

(graph/register! :php impl)
