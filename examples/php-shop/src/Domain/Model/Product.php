<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

final class Product
{
    public function __construct(
        public readonly string $sku,
        public readonly string $title,
        public readonly Money $price,
    ) {
    }
}
