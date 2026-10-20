<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

enum Currency: string
{
    case EUR = 'EUR';
    case USD = 'USD';
}
