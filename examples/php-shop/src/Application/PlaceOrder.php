<?php

declare(strict_types=1);

namespace Shop\Application;

use Shop\Domain\Model\Customer;
use Shop\Domain\Model\OrderLine;

final readonly class PlaceOrder
{
    /** @param list<OrderLine> $lines */
    public function __construct(
        public Customer $customer,
        public array $lines,
    ) {
    }
}
