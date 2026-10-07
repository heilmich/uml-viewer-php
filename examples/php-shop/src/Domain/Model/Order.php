<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

use Shop\Domain\Event\OrderPlaced;
use Shop\Domain\Exception\OrderAlreadyShipped;
use Shop\Domain\Shared\HasTimestamps;
use Shop\Infrastructure\Clock\SystemClock;

final class Order extends AggregateRoot
{
    use HasTimestamps;

    /** @var list<OrderLine> */
    private array $lines = [];

    private OrderStatus $status = OrderStatus::Draft;

    private function __construct(
        public readonly OrderId $id,
        private readonly Customer $customer,
    ) {
    }

    public static function place(Customer $customer, OrderLine ...$lines): self
    {
        $order = new self(OrderId::generate(), $customer);
        foreach ($lines as $line) {
            $order->lines[] = $line;
        }
        $order->status = OrderStatus::Placed;
        // Deliberate dependency-rule violation: the domain reaches out to
        // infrastructure. The viewer draws this arrow red.
        $order->touch(SystemClock::now());
        $order->record(new OrderPlaced($order->id, $order->createdAt()));
        return $order;
    }

    public function addLine(Product $product, int $quantity): void
    {
        $this->lines[] = new OrderLine($product, $quantity);
    }

    public function total(): Money
    {
        $total = Money::zero($this->customer->currency);
        foreach ($this->lines as $line) {
            $total = $total->add($line->subtotal());
        }
        return $total;
    }

    public function ship(): void
    {
        if ($this->status === OrderStatus::Shipped) {
            throw new OrderAlreadyShipped($this->id);
        }
        $this->status = OrderStatus::Shipped;
    }

    public function status(): OrderStatus
    {
        return $this->status;
    }
}
