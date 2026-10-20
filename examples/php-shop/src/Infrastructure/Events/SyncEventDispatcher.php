<?php

declare(strict_types=1);

namespace Shop\Infrastructure\Events;

use Psr\Log\LoggerInterface;
use Shop\Application\EventDispatcher;
use Shop\Domain\Event\DomainEvent;

final class SyncEventDispatcher implements EventDispatcher
{
    /** @var list<callable(DomainEvent): void> */
    private array $listeners = [];

    public function __construct(private readonly LoggerInterface $logger)
    {
    }

    public function listen(callable $listener): void
    {
        $this->listeners[] = $listener;
    }

    public function dispatch(DomainEvent ...$events): void
    {
        foreach ($events as $event) {
            foreach ($this->listeners as $listener) {
                $listener($event);
            }
            $this->logger->debug($event::class);
        }
    }
}
