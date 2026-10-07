<?php

declare(strict_types=1);

/*
 * AST fact dumper for the uml-viewer PHP LanguageGraph.
 *
 * Reads PHP file paths from STDIN (one per line), parses each file with
 * nikic/php-parser, resolves names, and writes one JSON document to STDOUT:
 *
 *   {"files": [{"file": "...", "errors": ["..."], "declarations": [...]}]}
 *
 * A declaration is a class, interface, trait, or enum. It carries its header
 * (extends, implements, used traits), typed properties, methods with
 * parameter and return types, enum cases, and every class it references
 * through `new`, static access, type hints, attributes, `instanceof`, and
 * `catch`. Names are fully qualified without the leading backslash.
 *
 * Usage: php scan.php < files.txt
 *
 * nikic/php-parser ships in vendor/ next to this script, so nothing needs
 * installing. UML_VIEWER_PHP_AUTOLOAD names another autoloader instead.
 */

use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;
use PhpParser\ErrorHandler\Collecting;

function uml_load_parser(): void
{
    $env = getenv('UML_VIEWER_PHP_AUTOLOAD');
    $autoload = is_string($env) && $env !== '' ? $env : __DIR__ . '/vendor/autoload.php';
    if (is_file($autoload)) {
        require_once $autoload;
    }
    if (!class_exists(ParserFactory::class)
        || !method_exists(ParserFactory::class, 'createForNewestSupportedVersion')) {
        fwrite(STDERR, "uml-viewer: nikic/php-parser ^5 not found at " . $autoload
            . ". Restore php/vendor from git, or run: composer install --working-dir=" . __DIR__ . PHP_EOL);
        exit(2);
    }
}

/** @return array<string, mixed> */
function uml_scan_file($parser, string $file): array
{
    $result = ['file' => $file, 'errors' => [], 'declarations' => []];
    $code = @file_get_contents($file);
    if ($code === false) {
        $result['errors'][] = 'cannot read file';
        return $result;
    }
    $errors = new Collecting();
    $stmts = $parser->parse($code, $errors);
    foreach ($errors->getErrors() as $error) {
        $result['errors'][] = $error->getMessage();
    }
    if ($stmts === null) {
        return $result;
    }
    $resolve = new NodeTraverser();
    $resolve->addVisitor(new NameResolver($errors));
    $stmts = $resolve->traverse($stmts);
    $collector = new UmlDeclarationCollector();
    $collect = new NodeTraverser();
    $collect->addVisitor($collector);
    $collect->traverse($stmts);
    foreach ($collector->declarations as $decl) {
        $decl['deps'] = array_values($decl['deps']);
        $result['declarations'][] = $decl;
    }
    return $result;
}

function uml_main(): int
{
    uml_load_parser();
    require_once __DIR__ . '/collector.php';
    $parser = (new ParserFactory())->createForNewestSupportedVersion();
    $files = [];
    while (($line = fgets(STDIN)) !== false) {
        $line = rtrim($line, "\r\n");
        if ($line !== '') {
            $files[] = $line;
        }
    }
    $out = ['files' => array_map(static fn (string $f): array => uml_scan_file($parser, $f), $files)];
    echo json_encode(
        $out,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR
    ), PHP_EOL;
    return 0;
}

exit(uml_main());
