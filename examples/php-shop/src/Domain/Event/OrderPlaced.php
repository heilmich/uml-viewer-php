<?php

declare(strict_types=1);

namespace Shop\Domain\Event;

use DateTimeImmutable;
use Shop\Domain\Model\OrderId;

final readonly class OrderPlaced implements DomainEvent
{
    public function __construct(
        public OrderId $orderId,
        private ?DateTimeImmutable $at,
    ) {
    }

    public function occurredAt(): DateTimeImmutable
    {
        return $this->at ?? new DateTimeImmutable();
    }
}
