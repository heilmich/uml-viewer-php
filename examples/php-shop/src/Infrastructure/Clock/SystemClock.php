<?php

declare(strict_types=1);

namespace Shop\Infrastructure\Clock;

use DateTimeImmutable;

final class SystemClock
{
    public static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable();
    }
}
