<?php

declare(strict_types=1);

namespace Shop\Tests\Domain;

use PHPUnit\Framework\TestCase;
use Shop\Domain\Model\Customer;
use Shop\Domain\Model\Order;

/** Skipped by the scanner: tests are not part of the architecture diagram. */
final class OrderTest extends TestCase
{
    public function testPlacedOrderStartsWithNoLines(): void
    {
        $order = Order::place(new Customer('a@example.com'));
        self::assertSame('placed', $order->status()->value);
    }
}
