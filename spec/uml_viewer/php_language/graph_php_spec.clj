(ns uml-viewer.php-language.graph-php-spec
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [speclj.core :refer :all]
            [uml-viewer.application.ir-generator :as ir-generator]
            [uml-viewer.graph :as graph]
            [uml-viewer.php-language.graph-php :as php]))

(defn- spit-file [dir rel content]
  (let [f (io/file dir rel)]
    (io/make-parents f)
    (spit f content)
    f))

(defn- temp-root []
  (io/file (System/getProperty "java.io.tmpdir")
           (str "uml-php-" (System/nanoTime))))

(def ^:private php-ready?
  (delay
    (try
      (let [p (.start (ProcessBuilder. ^java.util.List ["php" (php/scanner-path {})]))]
        (.close (.getOutputStream p))
        (slurp (.getInputStream p))
        (zero? (.waitFor p)))
      (catch Exception _ false))))

(defn- when-php [f]
  (if @php-ready?
    (f)
    (println "php not found; PHP scan skipped")))

(defn- by-id [g]
  (into {} (map (juxt :id identity) (:classes g))))

(defn- edge-set [g]
  (set (map (juxt :from :to :kind) (:edges g))))

(defn- decl [kind fqn & {:as more}]
  (merge {:kind kind
          :name fqn
          :short (last (str/split fqn #"\\"))
          :extends [] :implements [] :traits []
          :properties [] :methods [] :cases [] :deps []}
         more))

(defn- file-facts [path & decls]
  {:file path :errors [] :declarations (vec decls)})

(describe "php facts"
  (it "names classes by namespace and strips the prefix from ids"
    (let [g (php/facts->graph
              [(file-facts "src/Domain/User.php"
                           (decl "class" "App\\Domain\\User")
                           (decl "interface" "App\\Domain\\Users")
                           (decl "trait" "App\\Domain\\Named")
                           (decl "enum" "App\\Domain\\Role")
                           (decl "class" "App\\Domain\\Base" :abstract true))]
              {:prefix "App"})
          c (by-id g)]
      (should= #{:Domain.User :Domain.Users :Domain.Named :Domain.Role :Domain.Base}
               (set (keys c)))
      (should= "User" (:name (c :Domain.User)))
      (should= "App.Domain.User" (:ns (c :Domain.User)))
      (should= :php (:lang (c :Domain.User)))
      (should= "src/Domain/User.php" (:file (c :Domain.User)))
      (should-be-nil (:stereotype (c :Domain.User)))
      (should= :interface (:stereotype (c :Domain.Users)))
      (should= :trait (:stereotype (c :Domain.Named)))
      (should= :enumeration (:stereotype (c :Domain.Role)))
      (should= :abstract (:stereotype (c :Domain.Base)))))

  (it "nests a namespace outside the tree root under it"
    (let [g (php/facts->graph
              [(file-facts "a.php" (decl "class" "Legacy\\Mailer") (decl "class" "Kernel"))]
              {:prefix "shop" :ns-prefix "shop.php"})]
      (should= ["shop.php.Legacy.Mailer" "shop.php.Kernel"] (map :ns (:classes g)))
      (should= [:php.Legacy.Mailer :php.Kernel] (map :id (:classes g)))))

  (it "turns extends, implements, traits, and references into edges"
    (let [g (php/facts->graph
              [(file-facts "a.php"
                           (decl "class" "App\\Infra\\SqlUsers"
                                 :extends ["App\\Infra\\Repo"]
                                 :implements ["App\\Domain\\Users"]
                                 :traits ["App\\Infra\\Logs"]
                                 :deps [{:name "App\\Domain\\User" :via "new"}
                                        {:name "App\\Domain\\User" :via "type"}
                                        {:name "app\\domain\\ROLE" :via "static"}
                                        {:name "App\\Infra\\SqlUsers" :via "type"}
                                        {:name "Psr\\Log\\LoggerInterface" :via "type"}
                                        {:name "PDO" :via "type"}])
                           (decl "class" "App\\Infra\\Repo")
                           (decl "trait" "App\\Infra\\Logs")
                           (decl "interface" "App\\Domain\\Users")
                           (decl "class" "App\\Domain\\User")
                           (decl "enum" "App\\Domain\\Role"))]
              {:prefix "App"})
          c (by-id g)]
      (should= #{[:Infra.SqlUsers :Infra.Repo :inheritance]
                 [:Infra.SqlUsers :Domain.Users :implements]
                 [:Infra.SqlUsers :Infra.Logs :inheritance]
                 [:Infra.SqlUsers :Domain.User :dependency]
                 [:Infra.SqlUsers :Domain.Role :dependency]
                 [:Infra.SqlUsers :Psr.Log.LoggerInterface :dependency]
                 [:Infra.SqlUsers :PDO :dependency]}
               (edge-set g))
      (should= "use" (:label (first (filter #(= :Infra.Logs (:to %)) (:edges g)))))
      (should (:foreign (c :Psr.Log.LoggerInterface)))
      (should (:foreign (c :PDO)))
      (should= 1 (count (filter #(= [:Infra.SqlUsers :Domain.User] [(:from %) (:to %)])
                                (:edges g))))))

  (it "lists typed properties, enum cases, and methods"
    (let [g (php/facts->graph
              [(file-facts "a.php"
                           (decl "class" "App\\User"
                                 :properties [{:name "email" :type "Email" :visibility "private"
                                               :readonly true}
                                              {:name "count" :type "int" :visibility "public"
                                               :static true}
                                              {:name "notes" :type "?string" :visibility "protected"}]
                                 :methods [{:name "rename" :visibility "public"
                                            :params [{:name "name" :type "Name"}
                                                     {:name "tags" :type "string" :variadic true}]
                                            :returns "static"}
                                           {:name "check" :visibility "protected"
                                            :params [{:name "out" :byRef true}]}])
                           (decl "enum" "App\\Role" :cases [{:name "Admin"} {:name "Guest"}]))]
              {:prefix "App"})
          c (by-id g)]
      (should= ["- email : Email {readOnly}" "+ count : int {static}" "# notes : ?string"]
               (map :text (:fields (c :User))))
      (should= [{:name "rename" :text "rename(name: Name, ...tags: string) : static"}
                {:name "check" :text "check(&out)" :private true}]
               (:ops (c :User)))
      (should= ["Admin" "Guest"] (map :text (:fields (c :Role))))
      (should-not (contains? (c :Role) :ops))))

  (it "keeps the first of two declarations of one class"
    (let [g (php/facts->graph
              [(file-facts "a.php" (decl "class" "App\\Dup"))
               (file-facts "b.php" (decl "class" "App\\dup"))]
              {:prefix "App"})]
      (should= ["a.php"] (map :file (:classes g))))))

(describe "php graph"
  (it "parses a project with nikic/php-parser"
    (when-php
      (fn []
        (let [dir (temp-root)]
          (spit-file dir "src/Domain/Entity.php"
                     (str "<?php\nnamespace App\\Domain;\n"
                          "abstract class Entity {\n"
                          "  protected int $version = 0;\n"
                          "}\n"))
          (spit-file dir "src/Domain/User.php"
                     (str "<?php\ndeclare(strict_types=1);\n"
                          "namespace App\\Domain;\n"
                          "use App\\Domain\\Shared\\{HasName, Clock as Time};\n"
                          "use App\\Attr\\Audit;\n"
                          "#[Audit]\n"
                          "final class User extends Entity implements Identified {\n"
                          "  use HasName;\n"
                          "  private ?Email $email = null;\n"
                          "  public static int $count = 0;\n"
                          "  public const ?Level DEFAULT = null;\n"
                          "  public function __construct(public readonly UserId $id, private Role|Guest $role) {}\n"
                          "  public function rename(string $name, Tag ...$tags): static {\n"
                          "    $at = Time::now();\n"
                          "    try { $x = new Name($name); } catch (InvalidName | \\LogicException $e) {}\n"
                          "    if ($at instanceof Moment) {}\n"
                          "    $f = fn (Callback $c): Result => $c;\n"
                          "    $o = new class extends Listener { use Helps; private Gadget $g;\n"
                          "      public function ping(): Pong { return new Pong(); } };\n"
                          "    $k = [Registry::class, Counter::$hits];\n"
                          "    $u = new self($this->id, $this->role);\n"
                          "    return $this;\n"
                          "  }\n"
                          "  private function secret(): void {}\n"
                          "}\n"))
          (spit-file dir "src/Domain/Many.php"
                     (str "<?php\n"
                          "namespace App\\Domain\\Shared { trait HasName { public string $name = ''; } }\n"
                          "namespace App\\Domain { interface Identified { public function id(): UserId; } "
                          "enum Role: string implements Identified { case Admin = 'a'; "
                          "public function id(): UserId { return UserId::admin(); } } }\n"))
          (spit-file dir "src/Domain/Broken.php" "<?php\nnamespace App\\Domain;\nclass Broken { public function x( }\n")
          (spit-file dir "src/Domain/UserTest.php" "<?php\nnamespace App\\Domain;\nclass UserTest {}\n")
          (spit-file dir "src/tests/Helper.php" "<?php\nnamespace App\\Tests;\nclass Helper {}\n")
          (spit-file dir "src/vendor/lib/Lib.php" "<?php\nnamespace Lib;\nclass Lib {}\n")
          (let [g (binding [*err* (java.io.StringWriter.)]
                    (graph/scan (graph/lookup :php) (io/file dir "src") {:prefix "App"}))
                c (by-id g)
                project (set (map :id (remove :foreign (:classes g))))
                deps (set (keep (fn [e]
                                  (when (and (= :Domain.User (:from e))
                                             (= :dependency (:kind e)))
                                    (:to e)))
                                (:edges g)))
                user (c :Domain.User)]
            (should (contains? project :Domain.User))
            (should (contains? project :Domain.Entity))
            (should (contains? project :Domain.Shared.HasName))
            (should (contains? project :Domain.Identified))
            (should (contains? project :Domain.Role))
            (should-not (contains? project :Domain.UserTest))
            (should-not (some #(str/includes? (name %) "Helper") project))
            (should-not (some #(str/includes? (name %) "Lib") project))
            (should= :abstract (:stereotype (c :Domain.Entity)))
            (should= :trait (:stereotype (c :Domain.Shared.HasName)))
            (should= :interface (:stereotype (c :Domain.Identified)))
            (should= :enumeration (:stereotype (c :Domain.Role)))
            (should= ["Admin"] (map :text (:fields (c :Domain.Role))))
            (should (contains? (edge-set g) [:Domain.User :Domain.Entity :inheritance]))
            (should (contains? (edge-set g) [:Domain.User :Domain.Identified :implements]))
            (should (contains? (edge-set g) [:Domain.User :Domain.Shared.HasName :inheritance]))
            (should (contains? (edge-set g) [:Domain.Role :Domain.Identified :implements]))
            (should (contains? (edge-set g) [:Domain.Identified :App.Domain.UserId :dependency]))
            (should (:foreign (c :App.Domain.UserId)))
            (should= #{:Domain.Role :App.Domain.Email :App.Domain.UserId :App.Domain.Guest
                       :App.Domain.Tag :App.Domain.Shared.Clock :App.Domain.Name
                       :App.Domain.InvalidName :LogicException :App.Domain.Moment
                       :App.Domain.Callback :App.Domain.Result :App.Domain.Listener
                       :App.Attr.Audit :App.Domain.Level :App.Domain.Helps :App.Domain.Gadget
                       :App.Domain.Pong :App.Domain.Registry :App.Domain.Counter}
                     deps)
            (should= ["- email : ?Email" "+ count : int {static}"
                      "+ id : UserId {readOnly}" "- role : Role|Guest"]
                     (map :text (:fields user)))
            (should= [{:name "__construct" :text "__construct(id: UserId, role: Role|Guest)"}
                      {:name "rename" :text "rename(name: string, ...tags: Tag) : static"}
                      {:name "secret" :text "secret() : void" :private true}]
                     (:ops user))
            (should= "App.Domain.User" (:ns user))
            (should (str/ends-with? (:file user) "src/Domain/User.php")))))))

  (it "reports a missing php binary"
    (let [dir (temp-root)]
      (spit-file dir "src/A.php" "<?php class A {}\n")
      (should-throw clojure.lang.ExceptionInfo
                    (php/read-facts (php/source-files (io/file dir "src"))
                                    {:php (str (io/file dir "no-such-php"))}))))

  (it "skips php when there are no files"
    (let [dir (temp-root)]
      (.mkdirs (io/file dir "src"))
      (should= {:classes [] :edges []}
               (graph/scan (graph/lookup :php) (io/file dir "src")
                           {:prefix "App" :php "no-such-php"})))))

(describe "php shop example"
  (it "generates the sample IR with layers, foreign libraries, and one violation"
    (when-php
      (fn []
        (let [policy (ir-generator/read-policy "examples/php-shop.policy.edn")
              doc (ir-generator/document php/impl policy)
              c (by-id doc)
              edges (set (map (juxt :from :to :kind :violating) (:edges doc)))]
          (should (:hierarchical doc))
          (should= #{:Http :Application :Infrastructure :Domain}
                   (set (map #(keyword (first (str/split (name %) #"\.")))
                             (map :id (remove :foreign (:classes doc))))))
          (should= #{:Psr :DateTimeImmutable :DomainException :RuntimeException :PDO :PDOException}
                   (set (map :id (filter :foreign (:classes doc)))))
          (should= :interface (:stereotype (c :Domain.Repository.OrderRepository)))
          (should= :trait (:stereotype (c :Domain.Shared.HasTimestamps)))
          (should= :enumeration (:stereotype (c :Domain.Model.OrderStatus)))
          (should= :abstract (:stereotype (c :Domain.Model.AggregateRoot)))
          (should= 0 (:level (c :Domain.Model.Order)))
          (should= 2 (:level (c :Http.Controller.OrderController)))
          (should (contains? edges [:Domain.Model.Order :Infrastructure.Clock.SystemClock :dependency true]))
          (should (contains? edges [:Infrastructure.Persistence.PdoOrderRepository
                                    :Domain.Repository.OrderRepository :implements nil]))
          (should (contains? edges [:Domain.Model.Order :Domain.Shared.HasTimestamps :inheritance nil]))
          (should (contains? edges [:Http.Controller.OrderController :Http.Attribute.Route :dependency nil]))
          (should (contains? edges [:Application.PlaceOrderHandler :Domain.Exception.OrderAlreadyShipped
                                    :dependency nil]))
          (should (contains? edges [:Infrastructure.Events.SyncEventDispatcher :Psr :dependency nil]))
          (should= 1 (count (filter #(nth % 3) edges)))
          (should-not (some #(str/includes? (name (:id %)) "OrderTest") (:classes doc))))))))
