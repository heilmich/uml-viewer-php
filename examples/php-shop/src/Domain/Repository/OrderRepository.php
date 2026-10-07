<?php

declare(strict_types=1);

namespace Shop\Domain\Repository;

use Shop\Domain\Model\Order;
use Shop\Domain\Model\OrderId;

interface OrderRepository
{
    public function save(Order $order): void;

    public function find(OrderId $id): ?Order;
}
