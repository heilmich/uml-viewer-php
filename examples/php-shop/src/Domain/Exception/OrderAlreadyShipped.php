<?php

declare(strict_types=1);

namespace Shop\Domain\Exception;

use DomainException;
use Shop\Domain\Model\OrderId;

final class OrderAlreadyShipped extends DomainException
{
    public function __construct(public readonly OrderId $orderId)
    {
        parent::__construct(sprintf('Order %s is already shipped', $orderId->value));
    }
}
