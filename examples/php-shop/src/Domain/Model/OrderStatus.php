<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

use Shop\Domain\Shared\HasLabel;

enum OrderStatus: string implements HasLabel
{
    case Draft = 'draft';
    case Placed = 'placed';
    case Shipped = 'shipped';

    public function label(): string
    {
        return ucfirst($this->value);
    }
}
