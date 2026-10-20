<?php

declare(strict_types=1);

namespace Shop\Domain\Model;

final readonly class Money
{
    private function __construct(public int $cents, public Currency $currency)
    {
    }

    public static function of(int $cents, Currency $currency): self
    {
        return new self($cents, $currency);
    }

    public static function zero(Currency $currency): self
    {
        return new self(0, $currency);
    }

    public function add(Money $other): self
    {
        if ($other->currency !== $this->currency) {
            throw new \InvalidArgumentException('Currency mismatch');
        }
        return new self($this->cents + $other->cents, $this->currency);
    }

    public function times(int $factor): self
    {
        return new self($this->cents * $factor, $this->currency);
    }
}
