<?php

declare(strict_types=1);

namespace Shop\Domain\Shared;

use DateTimeImmutable;

trait HasTimestamps
{
    protected ?DateTimeImmutable $createdAt = null;

    public function touch(DateTimeImmutable $at): void
    {
        $this->createdAt ??= $at;
    }

    public function createdAt(): ?DateTimeImmutable
    {
        return $this->createdAt;
    }
}
