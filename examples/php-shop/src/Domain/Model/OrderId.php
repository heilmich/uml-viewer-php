<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

final readonly class OrderId
{
    public function __construct(public string $value)
    {
    }

    public static function generate(): self
    {
        return new self(bin2hex(random_bytes(8)));
    }
}
