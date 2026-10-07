<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

final class Customer
{
    public function __construct(
        public readonly string $email,
        public readonly Currency $currency = Currency::EUR,
    ) {
    }
}
