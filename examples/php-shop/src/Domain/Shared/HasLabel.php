<?php

declare(strict_types=1);

namespace Shop\Domain\Shared;

interface HasLabel
{
    public function label(): string;
}
