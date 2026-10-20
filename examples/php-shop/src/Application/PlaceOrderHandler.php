<?php

declare(strict_types=1);

namespace Shop\Application;

use Psr\Log\LoggerInterface;
use Shop\Domain\Event\OrderPlaced;
use Shop\Domain\Exception\OrderAlreadyShipped;
use Shop\Domain\Model\Order;
use Shop\Domain\Model\OrderId;
use Shop\Domain\Repository\OrderRepository;

final class PlaceOrderHandler
{
    public function __construct(
        private readonly OrderRepository $orders,
        private readonly EventDispatcher $events,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function __invoke(PlaceOrder $command): OrderId
    {
        $order = Order::place($command->customer, ...$command->lines);
        try {
            $this->orders->save($order);
        } catch (OrderAlreadyShipped $e) {
            $this->logger->warning($e->getMessage());
        }
        foreach ($order->releaseEvents() as $event) {
            if ($event instanceof OrderPlaced) {
                $this->logger->info('Order placed', ['id' => $event->orderId->value]);
            }
        }
        $this->events->dispatch(...$order->releaseEvents());
        return $order->id;
    }
}
