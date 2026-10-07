<?php

declare(strict_types=1);

/*
 * Keep php/vendor small enough to commit: the runtime library, its license,
 * and its composer.json. Composer runs this after install and update (see
 * composer.json "scripts"), so `composer update --working-dir=php` gives the
 * same tree that is checked in.
 */

$keep = ['lib', 'LICENSE', 'composer.json'];
$package = __DIR__ . '/vendor/nikic/php-parser';

function uml_remove(string $path): void
{
    if (is_link($path) || is_file($path)) {
        unlink($path);
        return;
    }
    if (!is_dir($path)) {
        return;
    }
    foreach (scandir($path) as $entry) {
        if ($entry !== '.' && $entry !== '..') {
            uml_remove($path . '/' . $entry);
        }
    }
    rmdir($path);
}

if (is_dir($package)) {
    foreach (scandir($package) as $entry) {
        if ($entry !== '.' && $entry !== '..' && !in_array($entry, $keep, true)) {
            uml_remove($package . '/' . $entry);
        }
    }
}
// The php-parse CLI proxy points into the bin/ directory removed above.
uml_remove(__DIR__ . '/vendor/bin');
