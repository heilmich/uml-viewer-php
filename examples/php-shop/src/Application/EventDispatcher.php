<?php

declare(strict_types=1);

namespace Shop\Application;

use Shop\Domain\Event\DomainEvent;

interface EventDispatcher
{
    public function dispatch(DomainEvent ...$events): void;
}
