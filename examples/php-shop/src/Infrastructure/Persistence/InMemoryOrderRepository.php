<?php

declare(strict_types=1);

namespace Shop\Infrastructure\Persistence;

use Shop\Domain\Model\Order;
use Shop\Domain\Model\OrderId;
use Shop\Domain\Repository\OrderRepository;

final class InMemoryOrderRepository implements OrderRepository
{
    /** @var array<string, Order> */
    private array $orders = [];

    public function save(Order $order): void
    {
        $this->orders[$order->id->value] = $order;
    }

    public function find(OrderId $id): ?Order
    {
        return $this->orders[$id->value] ?? null;
    }
}
