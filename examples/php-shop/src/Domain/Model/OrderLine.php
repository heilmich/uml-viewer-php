<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

final class OrderLine
{
    public function __construct(
        public readonly Product $product,
        public readonly int $quantity,
    ) {
    }

    public function subtotal(): Money
    {
        return $this->product->price->times($this->quantity);
    }
}
