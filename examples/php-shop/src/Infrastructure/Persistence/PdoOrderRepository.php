<?php

declare(strict_types=1);

namespace Shop\Infrastructure\Persistence;

use PDO;
use PDOException;
use Shop\Domain\Model\Order;
use Shop\Domain\Model\OrderId;
use Shop\Domain\Repository\OrderRepository;

final class PdoOrderRepository implements OrderRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function save(Order $order): void
    {
        try {
            $this->pdo
                ->prepare('INSERT INTO orders (id, status) VALUES (?, ?)')
                ->execute([$order->id->value, $order->status()->value]);
        } catch (PDOException $e) {
            throw new PersistenceFailed('Cannot save order', previous: $e);
        }
    }

    public function find(OrderId $id): ?Order
    {
        return null;
    }
}
