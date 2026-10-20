<?php

declare(strict_types=1);

/*
 * Name, type, and declaration helpers for scan.php. Loaded only after
 * nikic/php-parser is on the autoloader, because the collector extends
 * one of its classes.
 */

use PhpParser\Modifiers;
use PhpParser\Node;
use PhpParser\NodeVisitorAbstract;

/** Display text of a type node: `?Email`, `int|string`, `(A&B)|null`. */
function uml_type_text(?Node $type): ?string
{
    if ($type === null) {
        return null;
    }
    if ($type instanceof Node\NullableType) {
        return '?' . uml_type_text($type->type);
    }
    if ($type instanceof Node\UnionType) {
        return implode('|', array_map(
            static fn (Node $t): string => $t instanceof Node\IntersectionType
                ? '(' . uml_type_text($t) . ')'
                : (string) uml_type_text($t),
            $type->types
        ));
    }
    if ($type instanceof Node\IntersectionType) {
        return implode('&', array_map(static fn (Node $t): string => (string) uml_type_text($t), $type->types));
    }
    if ($type instanceof Node\Name) {
        return $type->getLast();
    }
    if ($type instanceof Node\Identifier) {
        return $type->toString();
    }
    return null;
}

/** Fully qualified class name of `$name`, or null for self/static/parent. */
function uml_class_name(Node $name): ?string
{
    if (!$name instanceof Node\Name || $name->isSpecialClassName()) {
        return null;
    }
    return ltrim($name->toString(), '\\');
}

/** Class names a type node mentions. Builtins and self/static/parent are skipped. */
function uml_type_names(?Node $type): array
{
    if ($type === null) {
        return [];
    }
    if ($type instanceof Node\NullableType) {
        return uml_type_names($type->type);
    }
    if ($type instanceof Node\UnionType || $type instanceof Node\IntersectionType) {
        return array_values(array_unique(array_merge(...array_map('uml_type_names', $type->types))));
    }
    $name = uml_class_name($type);
    return $name === null ? [] : [$name];
}

function uml_names(array $names): array
{
    return array_values(array_filter(array_map('uml_class_name', $names)));
}

function uml_visibility(int $flags): string
{
    if ($flags & Modifiers::PRIVATE) {
        return 'private';
    }
    if ($flags & Modifiers::PROTECTED) {
        return 'protected';
    }
    return 'public';
}

final class UmlDeclarationCollector extends NodeVisitorAbstract
{
    /** @var list<array<string, mixed>> */
    public array $declarations = [];

    /** @var list<int> indexes into $declarations of the open named class-likes */
    private array $open = [];

    public function enterNode(Node $node)
    {
        if ($node instanceof Node\Stmt\ClassLike) {
            if ($node->name === null) {
                $this->anonymousClass($node);
            } else {
                $this->open[] = count($this->declarations);
                $this->declarations[] = $this->header($node);
            }
            return null;
        }
        if (!$this->open) {
            return null;
        }
        $this->dependencies($node);
        return null;
    }

    public function leaveNode(Node $node)
    {
        if ($node instanceof Node\Stmt\ClassLike && $node->name !== null) {
            array_pop($this->open);
        }
        return null;
    }

    private function addDep(?string $name, string $via): void
    {
        if ($name === null || !$this->open) {
            return;
        }
        $i = $this->open[count($this->open) - 1];
        $key = $name . '|' . $via;
        $this->declarations[$i]['deps'][$key] = ['name' => $name, 'via' => $via];
    }

    private function addTypeDeps(?Node $type): void
    {
        foreach (uml_type_names($type) as $name) {
            $this->addDep($name, 'type');
        }
    }

    /** `new class(...) extends Base implements Port {}` depends on Base and Port. */
    private function anonymousClass(Node\Stmt\Class_ $node): void
    {
        if ($node->extends !== null) {
            $this->addDep(uml_class_name($node->extends), 'new');
        }
        foreach (uml_names($node->implements) as $name) {
            $this->addDep($name, 'new');
        }
    }

    private function dependencies(Node $node): void
    {
        if ($node instanceof Node\Expr\New_ && $node->class instanceof Node\Name) {
            $this->addDep(uml_class_name($node->class), 'new');
        } elseif (($node instanceof Node\Expr\StaticCall
                || $node instanceof Node\Expr\StaticPropertyFetch
                || $node instanceof Node\Expr\ClassConstFetch)
            && $node->class instanceof Node\Name) {
            $this->addDep(uml_class_name($node->class), 'static');
        } elseif ($node instanceof Node\Expr\Instanceof_ && $node->class instanceof Node\Name) {
            $this->addDep(uml_class_name($node->class), 'instanceof');
        } elseif ($node instanceof Node\Stmt\Catch_) {
            foreach (uml_names($node->types) as $name) {
                $this->addDep($name, 'catch');
            }
        } elseif ($node instanceof Node\Attribute) {
            $this->addDep(uml_class_name($node->name), 'attribute');
        } elseif ($node instanceof Node\Param) {
            $this->addTypeDeps($node->type);
        } elseif ($node instanceof Node\FunctionLike) {
            $this->addTypeDeps($node->getReturnType());
        } elseif ($node instanceof Node\Stmt\Property) {
            $this->addTypeDeps($node->type);
        } elseif ($node instanceof Node\Stmt\ClassConst) {
            // Typed class constants (PHP 8.3) need a parser that knows them.
            $this->addTypeDeps(property_exists($node, 'type') ? $node->type : null);
        } elseif ($node instanceof Node\Stmt\TraitUse) {
            // A trait used by an anonymous class; the named class's own traits
            // are read from its header.
            if (!$this->isHeaderTraitUse($node)) {
                foreach (uml_names($node->traits) as $name) {
                    $this->addDep($name, 'use');
                }
            }
        }
    }

    private function isHeaderTraitUse(Node\Stmt\TraitUse $node): bool
    {
        return (bool) $node->getAttribute('uml.header', false);
    }

    /** @return array<string, mixed> */
    private function header(Node\Stmt\ClassLike $node): array
    {
        $kind = match (true) {
            $node instanceof Node\Stmt\Interface_ => 'interface',
            $node instanceof Node\Stmt\Trait_ => 'trait',
            $node instanceof Node\Stmt\Enum_ => 'enum',
            default => 'class',
        };
        $fqn = ltrim($node->namespacedName !== null ? $node->namespacedName->toString() : $node->name->toString(), '\\');
        $pos = strrpos($fqn, '\\');
        $decl = [
            'kind' => $kind,
            'name' => $fqn,
            'short' => $node->name->toString(),
            'namespace' => $pos === false ? '' : substr($fqn, 0, $pos),
            'line' => $node->getStartLine(),
            'abstract' => $node instanceof Node\Stmt\Class_ && $node->isAbstract(),
            'final' => $node instanceof Node\Stmt\Class_ && $node->isFinal(),
            'readonly' => $node instanceof Node\Stmt\Class_ && $node->isReadonly(),
            'extends' => [],
            'implements' => [],
            'traits' => [],
            'backing' => null,
            'properties' => [],
            'methods' => [],
            'cases' => [],
            'deps' => [],
        ];
        if ($node instanceof Node\Stmt\Class_) {
            $decl['extends'] = $node->extends !== null ? uml_names([$node->extends]) : [];
            $decl['implements'] = uml_names($node->implements);
        } elseif ($node instanceof Node\Stmt\Interface_) {
            $decl['extends'] = uml_names($node->extends);
        } elseif ($node instanceof Node\Stmt\Enum_) {
            $decl['implements'] = uml_names($node->implements);
            $decl['backing'] = uml_type_text($node->scalarType);
        }
        foreach ($node->stmts as $stmt) {
            if ($stmt instanceof Node\Stmt\TraitUse) {
                $stmt->setAttribute('uml.header', true);
                $decl['traits'] = array_merge($decl['traits'], uml_names($stmt->traits));
            } elseif ($stmt instanceof Node\Stmt\Property) {
                foreach ($stmt->props as $prop) {
                    $decl['properties'][] = [
                        'name' => $prop->name->toString(),
                        'type' => uml_type_text($stmt->type),
                        'types' => uml_type_names($stmt->type),
                        'visibility' => uml_visibility($stmt->flags),
                        'static' => $stmt->isStatic(),
                        'readonly' => $stmt->isReadonly() || $decl['readonly'],
                        'promoted' => false,
                        'line' => $prop->getStartLine(),
                    ];
                }
            } elseif ($stmt instanceof Node\Stmt\ClassMethod) {
                $decl['methods'][] = $this->method($stmt, $decl);
            } elseif ($stmt instanceof Node\Stmt\EnumCase) {
                $decl['cases'][] = ['name' => $stmt->name->toString(), 'line' => $stmt->getStartLine()];
            }
        }
        $decl['traits'] = array_values(array_unique($decl['traits']));
        return $decl;
    }

    /** @return array<string, mixed> */
    private function method(Node\Stmt\ClassMethod $m, array &$decl): array
    {
        $params = [];
        foreach ($m->params as $p) {
            $name = $p->var instanceof Node\Expr\Variable && is_string($p->var->name) ? $p->var->name : '';
            $params[] = [
                'name' => $name,
                'type' => uml_type_text($p->type),
                'types' => uml_type_names($p->type),
                'variadic' => $p->variadic,
                'byRef' => $p->byRef,
                'default' => $p->default !== null,
            ];
            // Any visibility, readonly, or PHP 8.4 set-visibility flag promotes the parameter.
            $promoted = $p->flags & (Modifiers::PUBLIC | Modifiers::PROTECTED | Modifiers::PRIVATE
                | Modifiers::READONLY | 128 | 256 | 512);
            if ($promoted) {
                $decl['properties'][] = [
                    'name' => $name,
                    'type' => uml_type_text($p->type),
                    'types' => uml_type_names($p->type),
                    'visibility' => uml_visibility($p->flags),
                    'static' => false,
                    'readonly' => (bool) ($p->flags & Modifiers::READONLY) || $decl['readonly'],
                    'promoted' => true,
                    'line' => $p->getStartLine(),
                ];
            }
        }
        $interface = $decl['kind'] === 'interface';
        return [
            'name' => $m->name->toString(),
            'visibility' => $interface ? 'public' : uml_visibility($m->flags),
            'static' => $m->isStatic(),
            'abstract' => $interface || $m->isAbstract(),
            'final' => $m->isFinal(),
            'params' => $params,
            'returns' => uml_type_text($m->returnType),
            'returnTypes' => uml_type_names($m->returnType),
            'line' => $m->getStartLine(),
        ];
    }
}
